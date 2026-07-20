import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import * as Sentry from "@sentry/node";
import { pool } from "../../db/pool.js";
import { env } from "../../config/env.js";
import { logger } from "../logger.js";
import { ApiError } from "../errors.js";
import { getRedis } from "../redis.js";
import { ACCESS_COOKIE } from "../cookies.js";
import type { AuthUser, AuthedRequest } from "../types.js";

type JwtPayload = {
  sub: string;
  jti: string;
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

// Redis only backs the immediate-revocation check (logout/ban kill a session before its JWT
// naturally expires). A connection blip there must never look like "this user is logged out" -
// that would mass-logout everyone for a few seconds every time Redis hiccups. So a failed
// reachability check is treated as "can't confirm revocation right now" and falls back to
// trusting the JWT's own signature/expiry, not as "session revoked".
async function isSessionRevoked(jti: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  try {
    const exists = await redis.exists(`session:${jti}`);
    return !exists;
  } catch (error) {
    logger.warn({ error, jti }, "session_revocation_check_failed_redis_unavailable");
    return false;
  }
}

export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const token = req.cookies?.[ACCESS_COOKIE];
    if (!token) throw new ApiError(401, "Missing access token", "unauthorized");

    const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    if (await isSessionRevoked(payload.jti)) {
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
    if (await isSessionRevoked(payload.jti)) return next();

    const result = await pool.query<AuthUserRow>(AUTH_USER_SELECT, [payload.sub]);
    const row = result.rows[0];
    if (row && !row.isBanned && (payload.sv ?? 1) === row.sessionVersion) {
      const { sessionVersion: _sessionVersion, ...user } = row;
      req.user = user;
      req.sessionId = payload.jti;
      req.rateLimitUserId = user.id;
      req.rateLimitSessionId = payload.jti;
    }
    next();
  } catch {
    next();
  }
};
