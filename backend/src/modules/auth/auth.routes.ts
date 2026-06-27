import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { Router } from "express";
import jwt from "jsonwebtoken";
import type { Secret, SignOptions } from "jsonwebtoken";
import { nanoid } from "nanoid";
import { z } from "zod";
import { env } from "../../config/env.js";
import { pool } from "../../db/pool.js";
import { asyncHandler, badRequest } from "../../common/errors.js";
import { getRedis } from "../../common/redis.js";
import { authenticate } from "../../common/middleware/auth.js";
import { authRateLimit } from "../../common/middleware/security.js";
import { ACCESS_COOKIE, REFRESH_COOKIE, setAuthCookies, clearAuthCookies } from "../../common/cookies.js";
import type { AuthedRequest, Role } from "../../common/types.js";
import { disconnectSession } from "../chat/ws.service.js";

const router = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(2).max(80)
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

const telegramSchema = z.object({
  telegramId: z.string().min(3),
  username: z.string().min(2).max(80)
});

function hashRefreshToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function issueSession(userId: string, role: Role) {
  const jti = nanoid();
  const csrfToken = nanoid(32);
  const accessOptions: SignOptions = { expiresIn: `${env.ACCESS_TOKEN_TTL_MIN}m` as SignOptions["expiresIn"] };
  const accessToken = jwt.sign({ sub: userId, role, jti }, env.JWT_SECRET as Secret, accessOptions);

  const refreshToken = crypto.randomBytes(32).toString("base64url");
  const refreshTtlSeconds = env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60;

  const redis = getRedis();
  if (!redis) throw badRequest("Sessions are unavailable right now, try again shortly");
  await redis.set(`session:${jti}`, userId, "EX", env.ACCESS_TOKEN_TTL_MIN * 60);
  await redis.set(`refresh:${hashRefreshToken(refreshToken)}`, userId, "EX", refreshTtlSeconds);

  return { accessToken, refreshToken, csrfToken, jti };
}

async function revokeRefreshToken(token: string | undefined) {
  if (!token) return;
  const redis = getRedis();
  if (redis) await redis.del(`refresh:${hashRefreshToken(token)}`);
}

router.post(
  "/register",
  authRateLimit,
  asyncHandler(async (req, res) => {
    const input = registerSchema.parse(req.body);
    const passwordHash = await bcrypt.hash(input.password, 12);

    const result = await pool.query(
      `insert into users(email, password_hash, display_name, role)
       values ($1, $2, $3, $4)
       returning id, email, display_name as "displayName", role`,
      [input.email.toLowerCase(), passwordHash, input.displayName, "user"]
    );
    const user = result.rows[0];
    await pool.query(`insert into wallets(user_id, currency) values ($1, 'UAH') on conflict (user_id, currency) do nothing`, [user.id]);

    const session = await issueSession(user.id, user.role);
    setAuthCookies(res, session);
    res.status(201).json({ user });
  })
);

router.post(
  "/login",
  authRateLimit,
  asyncHandler(async (req, res) => {
    const input = loginSchema.parse(req.body);
    const result = await pool.query(
      `select id, email, password_hash, display_name as "displayName", role, is_banned as "isBanned"
       from users where email = $1`,
      [input.email.toLowerCase()]
    );
    const user = result.rows[0];
    if (!user?.password_hash) throw badRequest("Invalid email or password");
    if (user.isBanned) throw badRequest("Account is banned");

    const ok = await bcrypt.compare(input.password, user.password_hash);
    if (!ok) throw badRequest("Invalid email or password");

    const session = await issueSession(user.id, user.role);
    setAuthCookies(res, session);
    delete user.password_hash;
    res.json({ user });
  })
);

router.post(
  "/telegram",
  authRateLimit,
  asyncHandler(async (req, res) => {
    const input = telegramSchema.parse(req.body);
    const email = `tg_${input.telegramId}@telegram.local`;

    const result = await pool.query(
      `insert into users(email, display_name, role, telegram_id)
       values ($1, $2, 'user', $3)
       on conflict (telegram_id) do update set display_name = excluded.display_name
       returning id, email, display_name as "displayName", role`,
      [email, input.username, input.telegramId]
    );
    const user = result.rows[0];
    await pool.query(`insert into wallets(user_id, currency) values ($1, 'UAH') on conflict (user_id, currency) do nothing`, [user.id]);
    const session = await issueSession(user.id, user.role);
    setAuthCookies(res, session);
    res.json({ user, stub: true });
  })
);

router.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const refreshToken = req.cookies?.[REFRESH_COOKIE];
    if (!refreshToken) throw badRequest("Missing refresh token");

    const redis = getRedis();
    if (!redis) throw badRequest("Sessions are unavailable right now, try again shortly");

    const tokenHash = hashRefreshToken(refreshToken);
    const userId = await redis.get(`refresh:${tokenHash}`);
    if (!userId) {
      clearAuthCookies(res);
      throw badRequest("Refresh token is invalid or expired");
    }
    // Rotate: the old refresh token can never be redeemed again.
    await redis.del(`refresh:${tokenHash}`);

    const result = await pool.query(
      `select id, email, display_name as "displayName", role, is_banned as "isBanned" from users where id = $1`,
      [userId]
    );
    const user = result.rows[0];
    if (!user || user.isBanned) {
      clearAuthCookies(res);
      throw badRequest("Account is unavailable");
    }

    const session = await issueSession(user.id, user.role);
    setAuthCookies(res, session);
    delete user.isBanned;
    res.json({ user });
  })
);

router.get(
  "/me",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    res.json({ user: req.user });
  })
);

router.post(
  "/logout",
  authenticate,
  asyncHandler(async (req, res) => {
    const accessToken = req.cookies?.[ACCESS_COOKIE];
    const refreshToken = req.cookies?.[REFRESH_COOKIE];

    if (accessToken) {
      const payload = jwt.decode(accessToken) as { jti?: string } | null;
      if (payload?.jti) {
        const redis = getRedis();
        if (redis) await redis.del(`session:${payload.jti}`);
        disconnectSession(payload.jti);
      }
    }
    await revokeRefreshToken(refreshToken);

    clearAuthCookies(res);
    res.status(204).send();
  })
);

export default router;
