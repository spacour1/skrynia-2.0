import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import type { Secret, SignOptions } from "jsonwebtoken";
import { nanoid } from "nanoid";
import { env } from "../../config/env.js";
import { pool, type DbClient } from "../../db/pool.js";
import { serviceUnavailable, unauthorized } from "../../common/errors.js";
import { getRedis } from "../../common/redis.js";
import { logger } from "../../common/logger.js";
import type { Role } from "../../common/types.js";
import { publishSessionSecurityEvent } from "./session-events.service.js";

export function hashRefreshToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function userSessionsKey(userId: string) {
  return `user_sessions:${userId}`;
}

function userRefreshKey(userId: string) {
  return `user_refresh:${userId}`;
}

/**
 * Increments the user's session invalidation epoch. Must run on the same client (and
 * therefore in the same transaction) as the security-state change it protects -
 * password change/reset, 2FA disable/replacement, ban, logout-all - so old sessions
 * become invalid exactly when the change commits, whether or not Redis is reachable.
 */
export async function bumpSessionVersion(client: DbClient, userId: string): Promise<number> {
  const result = await client.query<{ sessionVersion: number }>(
    `update users set session_version = session_version + 1, updated_at = now()
     where id = $1
     returning session_version as "sessionVersion"`,
    [userId]
  );
  if (!result.rows[0]) throw unauthorized("Account is unavailable");
  return result.rows[0].sessionVersion;
}

type RefreshRecord = { userId: string; sessionVersion: number };

/**
 * Refresh records are JSON `{"u":...,"v":...}`. Records written before the
 * session-version rollout hold a plain user id; they are treated as version 1 - the
 * migration default every existing user starts at - so they stay valid exactly until
 * the user's first security-sensitive change bumps the version.
 */
export function parseRefreshRecord(value: string): RefreshRecord | null {
  try {
    const parsed = JSON.parse(value) as { u?: unknown; v?: unknown };
    if (typeof parsed === "object" && parsed !== null && typeof parsed.u === "string") {
      return { userId: parsed.u, sessionVersion: typeof parsed.v === "number" ? parsed.v : 1 };
    }
  } catch {
    // Legacy plain-string record.
  }
  return value ? { userId: value, sessionVersion: 1 } : null;
}

export async function issueSession(userId: string, role: Role) {
  const versionResult = await pool.query<{ sessionVersion: number }>(
    `select session_version as "sessionVersion" from users where id = $1`,
    [userId]
  );
  const sessionVersion = versionResult.rows[0]?.sessionVersion;
  if (sessionVersion === undefined) throw unauthorized("Account is unavailable");

  const jti = nanoid();
  const csrfToken = nanoid(32);
  const accessOptions: SignOptions = { expiresIn: `${env.ACCESS_TOKEN_TTL_MIN}m` as SignOptions["expiresIn"] };
  const accessToken = jwt.sign({ sub: userId, role, jti, sv: sessionVersion }, env.JWT_SECRET as Secret, accessOptions);

  const refreshToken = crypto.randomBytes(32).toString("base64url");
  const refreshTtlSeconds = env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60;
  const refreshHash = hashRefreshToken(refreshToken);

  const redis = getRedis();
  if (!redis) throw serviceUnavailable("Sessions are unavailable right now, try again shortly");

  // One MULTI so a connection failure mid-issue cannot leave a partially created
  // session (e.g. a live refresh record whose jti is untracked and unenumerable).
  // The per-user sets exist purely so revokeAllUserSessions can find every
  // outstanding session - the keys addressed by jti/hash cannot be listed by user.
  const results = await redis
    .multi()
    .set(`session:${jti}`, userId, "EX", env.ACCESS_TOKEN_TTL_MIN * 60)
    .set(`refresh:${refreshHash}`, JSON.stringify({ u: userId, v: sessionVersion }), "EX", refreshTtlSeconds)
    .sadd(userSessionsKey(userId), jti)
    .expire(userSessionsKey(userId), refreshTtlSeconds)
    .sadd(userRefreshKey(userId), refreshHash)
    .expire(userRefreshKey(userId), refreshTtlSeconds)
    .exec();
  if (!results || results.some(([error]) => error)) {
    throw serviceUnavailable("Sessions are unavailable right now, try again shortly");
  }

  return { accessToken, refreshToken, csrfToken, jti, sessionVersion };
}

const TWO_FACTOR_PENDING_TTL_MIN = 5;

/**
 * A short-lived bridge token between "password verified" and "session issued" for 2FA
 * accounts. Deliberately not a real session: no jti, not tracked in Redis, can't be used
 * for anything except POST /auth/2fa/verify, and expires in minutes rather than days.
 */
export function issueTwoFactorPendingToken(userId: string): string {
  return jwt.sign({ sub: userId, purpose: "2fa_pending" }, env.JWT_SECRET as Secret, {
    expiresIn: `${TWO_FACTOR_PENDING_TTL_MIN}m` as SignOptions["expiresIn"]
  });
}

export function verifyTwoFactorPendingToken(token: string): string {
  const payload = jwt.verify(token, env.JWT_SECRET as Secret) as { sub: string; purpose?: string };
  if (payload.purpose !== "2fa_pending") throw new Error("Invalid token purpose");
  return payload.sub;
}

export async function revokeRefreshToken(token: string | undefined, userId?: string) {
  if (!token) return;
  const redis = getRedis();
  if (!redis) return;
  const hash = hashRefreshToken(token);
  await redis.del(`refresh:${hash}`);
  if (userId) await redis.srem(userRefreshKey(userId), hash);
}

export async function revokeSession(jti: string | undefined, userId?: string) {
  if (!jti) return;
  const redis = getRedis();
  try {
    if (redis) {
      await redis.del(`session:${jti}`);
      if (userId) await redis.srem(userSessionsKey(userId), jti);
    }
  } finally {
    await publishSessionSecurityEvent({
      type: "session.revoked",
      sessionId: jti
    });
  }
}

/**
 * Revokes every session a user currently has (used for logout-everywhere, security
 * changes, password reset, and admin bans). A workflow that uses `exceptJti` must also
 * preserve a usable refresh token for that session.
 */
export async function revokeAllUserSessions(
  userId: string,
  options: {
    exceptJti?: string;
    strict?: boolean;
    publishEvent?: boolean;
  } = {}
) {
  const redis = getRedis();
  let redisError: unknown;
  if (redis) {
    try {
      const [jtis, hashes] = await Promise.all([
        redis.smembers(userSessionsKey(userId)),
        redis.smembers(userRefreshKey(userId))
      ]);

      const keysToDelete = [
        ...jtis.filter((jti) => jti !== options.exceptJti).map((jti) => `session:${jti}`),
        ...hashes.map((hash) => `refresh:${hash}`)
      ];
      if (keysToDelete.length) await redis.del(...keysToDelete);

      await redis.del(userSessionsKey(userId), userRefreshKey(userId));
      if (options.exceptJti) await redis.sadd(userSessionsKey(userId), options.exceptJti);
    } catch (error) {
      redisError = error;
      logger.error({ error, userId }, "revoke_all_user_sessions_failed");
    }
  }

  let realtimeError: unknown;
  if (options.publishEvent !== false) {
    try {
      await publishSessionSecurityEvent(
        {
          type: "user.sessions.revoked",
          userId,
          exceptSessionId: options.exceptJti
        },
        { strict: options.strict }
      );
    } catch (error) {
      realtimeError = error;
    }
  }
  if (options.strict && redisError) throw redisError;
  if (options.strict && realtimeError) throw realtimeError;
}
