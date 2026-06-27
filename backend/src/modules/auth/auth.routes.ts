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
import { verifyTelegramAuth } from "./telegram.service.js";
import {
  consumeEmailVerificationToken,
  createPasswordResetToken,
  consumePasswordResetToken,
  createAndSendVerificationEmail,
  checkResendRateLimit,
  sendPasswordResetEmail,
  fireAndForget
} from "./verification.service.js";
import { logger } from "../../common/logger.js";

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
  id: z.union([z.number(), z.string()]),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  photo_url: z.string().optional(),
  auth_date: z.union([z.number(), z.string()]),
  hash: z.string()
});

const emailVerifyConfirmSchema = z.object({ token: z.string().min(1) });
const passwordForgotSchema = z.object({ email: z.string().email() });
const passwordResetSchema = z.object({ token: z.string().min(1), password: z.string().min(8) });

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
       returning id, email, display_name as "displayName", role,
                 (email_verified_at is not null or telegram_id is not null) as "emailVerified"`,
      [input.email.toLowerCase(), passwordHash, input.displayName, "user"]
    );
    const user = result.rows[0];
    await pool.query(`insert into wallets(user_id, currency) values ($1, 'UAH') on conflict (user_id, currency) do nothing`, [user.id]);

    const session = await issueSession(user.id, user.role);
    setAuthCookies(res, session);

    // Token creation (Redis) and the email send itself must never fail registration —
    // the account and wallet are already committed by this point.
    let debugVerificationUrl: string | undefined;
    try {
      const { link, sendPromise } = await createAndSendVerificationEmail(user);
      fireAndForget(sendPromise, "registration_verification_email_failed");
      if (env.NODE_ENV !== "production") debugVerificationUrl = link;
    } catch (error) {
      logger.error({ error, userId: user.id }, "registration_verification_token_failed");
    }

    res.status(201).json({ user, ...(debugVerificationUrl ? { debugVerificationUrl } : {}) });
  })
);

router.post(
  "/login",
  authRateLimit,
  asyncHandler(async (req, res) => {
    const input = loginSchema.parse(req.body);
    const result = await pool.query(
      `select id, email, password_hash, display_name as "displayName", role, is_banned as "isBanned",
              (email_verified_at is not null or telegram_id is not null) as "emailVerified"
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
    verifyTelegramAuth(input);

    const telegramId = String(input.id);
    const displayName = input.username ?? input.first_name ?? telegramId;
    const email = `tg_${telegramId}@telegram.local`;

    const result = await pool.query(
      `insert into users(email, display_name, role, telegram_id)
       values ($1, $2, 'user', $3)
       on conflict (telegram_id) do update set display_name = excluded.display_name
       returning id, email, display_name as "displayName", role,
                 (email_verified_at is not null or telegram_id is not null) as "emailVerified"`,
      [email, displayName, telegramId]
    );
    const user = result.rows[0];
    await pool.query(`insert into wallets(user_id, currency) values ($1, 'UAH') on conflict (user_id, currency) do nothing`, [user.id]);
    const session = await issueSession(user.id, user.role);
    setAuthCookies(res, session);
    res.json({ user });
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
      `select id, email, display_name as "displayName", role, is_banned as "isBanned",
              (email_verified_at is not null or telegram_id is not null) as "emailVerified"
       from users where id = $1`,
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

router.post(
  "/verify-email/request",
  authenticate,
  authRateLimit,
  asyncHandler(async (req: AuthedRequest, res) => {
    const result = await pool.query(
      `select id, email, display_name as "displayName",
              (email_verified_at is not null or telegram_id is not null) as "emailVerified"
       from users where id = $1`,
      [req.user.id]
    );
    const user = result.rows[0];
    if (!user) throw badRequest("Account not found");
    if (user.emailVerified) return res.json({ status: "already_verified" });

    await checkResendRateLimit(user.id);
    const { link, sendPromise } = await createAndSendVerificationEmail(user);

    if (env.NODE_ENV === "production") {
      // Unlike registration, this is an explicit user action waiting on an email - a
      // broken/unconfigured SMTP setup should surface as a real error here, not a
      // silent "sent" (sendEmail resolves false rather than throwing when SMTP_HOST
      // isn't set, since that path is allowed to exist outside production).
      let sent = false;
      try {
        sent = await sendPromise;
      } catch (error) {
        logger.error({ error, userId: user.id }, "verification_email_resend_failed");
        throw badRequest("Could not send the verification email right now, try again later");
      }
      if (!sent) {
        logger.error({ userId: user.id }, "verification_email_resend_smtp_unconfigured");
        throw badRequest("Could not send the verification email right now, try again later");
      }
      return res.json({ status: "sent" });
    }

    fireAndForget(sendPromise, "verification_email_resend_failed");
    res.json({ status: "sent", debugVerificationUrl: link });
  })
);

router.post(
  "/verify-email/confirm",
  authRateLimit,
  asyncHandler(async (req, res) => {
    const input = emailVerifyConfirmSchema.parse(req.body);
    const userId = await consumeEmailVerificationToken(input.token);
    await pool.query(`update users set email_verified_at = now() where id = $1 and email_verified_at is null`, [userId]);
    res.json({ status: "verified" });
  })
);

router.post(
  "/password/forgot",
  authRateLimit,
  asyncHandler(async (req, res) => {
    const input = passwordForgotSchema.parse(req.body);
    const result = await pool.query(`select id, email from users where email = $1`, [input.email.toLowerCase()]);
    const user = result.rows[0];

    // Always respond the same way whether or not the account exists, so this endpoint
    // can't be used to enumerate registered emails.
    if (user) {
      const token = await createPasswordResetToken(user.id);
      const link = `${env.FRONTEND_URL}/reset-password?token=${token}`;
      fireAndForget(sendPasswordResetEmail(user, link), "password_reset_email_failed");
    }
    res.json({ status: "sent" });
  })
);

router.post(
  "/password/reset",
  authRateLimit,
  asyncHandler(async (req, res) => {
    const input = passwordResetSchema.parse(req.body);
    const userId = await consumePasswordResetToken(input.token);
    const passwordHash = await bcrypt.hash(input.password, 12);
    await pool.query(`update users set password_hash = $2, updated_at = now() where id = $1`, [userId, passwordHash]);
    res.json({ status: "reset" });
  })
);

export default router;
