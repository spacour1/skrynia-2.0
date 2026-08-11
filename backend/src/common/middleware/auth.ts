import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import * as Sentry from "@sentry/node";
import { pool } from "../../db/pool.js";
import { env } from "../../config/env.js";
import { logger } from "../logger.js";
import { ApiError, serviceUnavailable } from "../errors.js";
import { getRedis } from "../redis.js";
import { ACCESS_COOKIE } from "../cookies.js";
import type { AuthUser, AuthedRequest } from "../types.js";

type JwtPayload = {
  sub: string;
  jti: string;
  fid?: string;
  /** Session version the token was issued under; absent on pre-rollout tokens (treated as 1). */
  sv?: number;
};

type AuthUserRow = AuthUser & { sessionVersion: number };

const AUTH_USER_SELECT = `
  select id, email, display_name as "displayName", role, is_banned as "isBanned",
         session_version as "sessionVersion",
         (email_verified_at is not null or telegram_id is not null) as "emailVerified",
         (phone_verified_at is not null) as "phoneVerified"
  from users
  where id = $1`;

// Redis is the durable per-session/family revocation authority. If it cannot be checked,
// authenticated requests fail with a retryable 503 instead of trusting a JWT that may
// already have been logged out. Optional authentication simply remains anonymous.
function isActiveFamilyRecord(raw: unknown, userId: string): boolean {
  if (typeof raw !== "string") return false;
  try {
    const record = JSON.parse(raw) as { s?: unknown; u?: unknown };
    return record.s === "active" && record.u === userId;
  } catch {
    return false;
  }
}

async function isSessionRevoked(jti: string, familyId: string | undefined, userId: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) throw serviceUnavailable("Session verification is temporarily unavailable");
  try {
    const transaction = redis
      .multi()
      .exists(`session:${jti}`)
      .exists(`session_revoked:${jti}`);
    if (familyId) transaction.get(`refresh_family:${familyId}`);
    const results = await transaction.exec();
    if (!results || results.some(([error]) => error)) {
      throw new Error("Session revocation transaction failed");
    }
    const sessionExists = Number(results[0]?.[1]) === 1;
    const exactTombstoneExists = Number(results[1]?.[1]) === 1;
    const familyActive = familyId
      ? isActiveFamilyRecord(results[2]?.[1], userId)
      : true;
    return !sessionExists || exactTombstoneExists || !familyActive;
  } catch (error) {
    logger.warn({ error, jti, familyId }, "session_revocation_check_failed_redis_unavailable");
    throw serviceUnavailable("Session verification is temporarily unavailable");
  }
}

export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const token = req.cookies?.[ACCESS_COOKIE];
    if (!token) throw new ApiError(401, "Missing access token", "unauthorized");

    const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    const familyId = typeof payload.fid === "string" && payload.fid ? payload.fid : undefined;
    if (await isSessionRevoked(payload.jti, familyId, payload.sub)) {
      throw new ApiError(401, "Session expired", "unauthorized");
    }

    const result = await pool.query<AuthUserRow>(AUTH_USER_SELECT, [payload.sub]);
    const row = result.rows[0];
    if (!row) throw new ApiError(401, "Invalid access token", "unauthorized");
    if (row.isBanned) throw new ApiError(403, "Account is banned", "account_banned");
    // The DB-backed epoch check: a security-sensitive change bumped the version, so
    // every token issued before it is dead regardless of Redis availability.
    if ((payload.sv ?? 1) !== row.sessionVersion) {
      throw new ApiError(401, "Session expired", "unauthorized");
    }

    const { sessionVersion: _sessionVersion, ...user } = row;
    req.user = user;
    req.sessionId = payload.jti;
    req.sessionFamilyId = familyId;
    req.sessionVersion = row.sessionVersion;
    req.rateLimitUserId = user.id;
    req.rateLimitSessionId = payload.jti;
    Sentry.setUser({ id: user.id, segment: user.role });
    next();
  } catch (error) {
    next(error instanceof ApiError ? error : new ApiError(401, "Invalid access token", "unauthorized"));
  }
};

export function requireAuth(req: Partial<AuthedRequest>): asserts req is AuthedRequest {
  if (!req.user) throw new ApiError(401, "Unauthorized", "unauthorized");
}

/**
 * Populates req.user when a valid access token is present, but never rejects the request:
 * anonymous, expired, revoked or banned viewers simply continue without a user. For public
 * endpoints that behave differently for the resource owner or staff (e.g. previewing a
 * paused listing) - authorization decisions stay in the route, this only identifies.
 */
export const authenticateOptional: RequestHandler = async (req, _res, next) => {
  try {
    const token = req.cookies?.[ACCESS_COOKIE];
    if (!token) return next();

    const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    const familyId = typeof payload.fid === "string" && payload.fid ? payload.fid : undefined;
    if (await isSessionRevoked(payload.jti, familyId, payload.sub)) return next();

    const result = await pool.query<AuthUserRow>(AUTH_USER_SELECT, [payload.sub]);
    const row = result.rows[0];
    if (row && !row.isBanned && (payload.sv ?? 1) === row.sessionVersion) {
      const { sessionVersion: _sessionVersion, ...user } = row;
      req.user = user;
      req.sessionId = payload.jti;
      req.sessionFamilyId = familyId;
      req.sessionVersion = row.sessionVersion;
      req.rateLimitUserId = user.id;
      req.rateLimitSessionId = payload.jti;
    }
    next();
  } catch {
    next();
  }
};
