import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
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
};

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

    const result = await pool.query<AuthUser>(
      `select id, email, display_name as "displayName", role, is_banned as "isBanned",
              (email_verified_at is not null or telegram_id is not null) as "emailVerified"
       from users
       where id = $1`,
      [payload.sub]
    );
    const user = result.rows[0];
    if (!user) throw new ApiError(401, "Invalid access token", "unauthorized");
    if (user.isBanned) throw new ApiError(403, "Account is banned", "account_banned");

    req.user = user;
    req.sessionId = payload.jti;
    next();
  } catch (error) {
    next(error instanceof ApiError ? error : new ApiError(401, "Invalid access token", "unauthorized"));
  }
};

export function requireAuth(req: Partial<AuthedRequest>): asserts req is AuthedRequest {
  if (!req.user) throw new ApiError(401, "Unauthorized", "unauthorized");
}
