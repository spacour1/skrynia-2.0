import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { pool } from "../../db/pool.js";
import { env } from "../../config/env.js";
import { ApiError } from "../errors.js";
import { getRedis } from "../redis.js";
import { ACCESS_COOKIE } from "../cookies.js";
import type { AuthUser, AuthedRequest } from "../types.js";

type JwtPayload = {
  sub: string;
  jti: string;
};

export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const token = req.cookies?.[ACCESS_COOKIE];
    if (!token) throw new ApiError(401, "Missing access token", "unauthorized");

    const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    const redis = getRedis();
    if (redis) {
      const exists = await redis.exists(`session:${payload.jti}`);
      if (!exists) throw new ApiError(401, "Session expired", "unauthorized");
    }

    const result = await pool.query<AuthUser>(
      `select id, email, display_name as "displayName", role, is_banned as "isBanned"
       from users
       where id = $1`,
      [payload.sub]
    );
    const user = result.rows[0];
    if (!user) throw new ApiError(401, "Invalid access token", "unauthorized");
    if (user.isBanned) throw new ApiError(403, "Account is banned", "account_banned");

    req.user = user;
    next();
  } catch (error) {
    next(error instanceof ApiError ? error : new ApiError(401, "Invalid access token", "unauthorized"));
  }
};

export function requireAuth(req: Partial<AuthedRequest>): asserts req is AuthedRequest {
  if (!req.user) throw new ApiError(401, "Unauthorized", "unauthorized");
}
