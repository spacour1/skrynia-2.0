import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import type { Secret, SignOptions } from "jsonwebtoken";
import { nanoid } from "nanoid";
import { env } from "../../config/env.js";
import { serviceUnavailable } from "../../common/errors.js";
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

export async function issueSession(userId: string, role: Role) {
  const jti = nanoid();
  const csrfToken = nanoid(32);
  const accessOptions: SignOptions = { expiresIn: `${env.ACCESS_TOKEN_TTL_MIN}m` as SignOptions["expiresIn"] };
  const accessToken = jwt.sign({ sub: userId, role, jti }, env.JWT_SECRET as Secret, accessOptions);

  const refreshToken = crypto.randomBytes(32).toString("base64url");
  const refreshTtlSeconds = env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60;
  const refreshHash = hashRefreshToken(refreshToken);

  const redis = getRedis();
  if (!redis) throw serviceUnavailable("Sessions are unavailable right now, try again shortly");

  await redis.set(`session:${jti}`, userId, "EX", env.ACCESS_TOKEN_TTL_MIN * 60);
  await redis.set(`refresh:${refreshHash}`, userId, "EX", refreshTtlSeconds);

  // Tracked per-user purely so revokeAllUserSessions can find every outstanding session -
  // the keys above (addressed by jti/hash) have no other way to be enumerated by user.
  await redis.sadd(userSessionsKey(userId), jti);
  await redis.expire(userSessionsKey(userId), refreshTtlSeconds);
  await redis.sadd(userRefreshKey(userId), refreshHash);
  await redis.expire(userRefreshKey(userId), refreshTtlSeconds);

  return { accessToken, refreshToken, csrfToken, jti };
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
    publishSessionSecurityEvent({ type: "session.revoked", sessionId: jti });
  }
}

/**
 * Revokes every session a user currently has (used for logout-everywhere, security
 * changes, password reset, and admin bans). A workflow that uses `exceptJti` must also
 * preserve a usable refresh token for that session.
 */
export async function revokeAllUserSessions(userId: string, options: { exceptJti?: string } = {}) {
  const redis = getRedis();
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
      logger.error({ error, userId }, "revoke_all_user_sessions_failed");
    }
  }

  // Local sockets must close even when Redis is unavailable. Stage 11 promotes this
  // process-local event to Redis Pub/Sub for cross-replica delivery.
  publishSessionSecurityEvent({
    type: "user.sessions.revoked",
    userId,
    exceptSessionId: options.exceptJti
  });
}
