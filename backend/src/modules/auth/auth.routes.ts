import bcrypt from "bcryptjs";
import { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env.js";
import { inTx, pool } from "../../db/pool.js";
import { ApiError, asyncHandler, badRequest, forbidden, serviceUnavailable } from "../../common/errors.js";
import { getRedis } from "../../common/redis.js";
import { authenticate } from "../../common/middleware/auth.js";
import {
  credentialRateLimit,
  emailVerificationRateLimit,
  passwordResetRateLimit,
  wsTicketRateLimit
} from "../../common/middleware/security.js";
import { REFRESH_COOKIE, setAuthCookies, clearAuthCookies } from "../../common/cookies.js";
import type { AuthedRequest } from "../../common/types.js";
import { verifyTelegramAuth } from "./telegram.service.js";
import {
  hashRefreshToken,
  issueSession,
  issueTwoFactorPendingToken,
  revokeAllUserSessions,
  revokeRefreshToken,
  revokeSession,
  verifyTwoFactorPendingToken
} from "./session.service.js";
import { verifyTwoFactorCode } from "./twofa.service.js";
import { issueWsTicket } from "./ws-ticket.service.js";
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
import { getRequestLocale } from "../../i18n/t.js";

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
const twoFactorVerifySchema = z.object({ twoFactorToken: z.string().min(1), code: z.string().min(4).max(16) });

router.post(
  "/register",
  credentialRateLimit,
  asyncHandler(async (req, res) => {
    const input = registerSchema.parse(req.body);
    const passwordHash = await bcrypt.hash(input.password, 12);

    // The account and its mandatory child rows commit or roll back together — a failure
    // after the user insert must not leave a wallet-less account behind. A duplicate
    // email surfaces as a 23505 on users_email_key, which the global error handler maps
    // to a 409; no pre-SELECT is needed. The session and the verification email are
    // deliberately outside the transaction: no external calls inside a DB transaction,
    // and no session for an account that did not fully commit.
    const user = await inTx(async (client) => {
      const result = await client.query(
        `insert into users(email, password_hash, display_name, role)
         values ($1, $2, $3, $4)
         returning id, email, display_name as "displayName", role,
                   (email_verified_at is not null or telegram_id is not null) as "emailVerified"`,
        [input.email.toLowerCase(), passwordHash, input.displayName, "user"]
      );
      const created = result.rows[0];
      await client.query(
        `insert into wallets(user_id, currency) values ($1, 'UAH') on conflict (user_id, currency) do nothing`,
        [created.id]
      );
      return created;
    });

    const session = await issueSession(user.id, user.role);
    setAuthCookies(res, session);

    // Token creation (Redis) and the email send itself must never fail registration —
    // the account and wallet are already committed by this point.
    let debugVerificationUrl: string | undefined;
    try {
      const { link, sendPromise } = await createAndSendVerificationEmail(user, getRequestLocale(req));
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
  credentialRateLimit,
  asyncHandler(async (req, res) => {
    const input = loginSchema.parse(req.body);
    const result = await pool.query(
      `select id, email, password_hash, display_name as "displayName", role, is_banned as "isBanned",
              two_factor_enabled as "twoFactorEnabled",
              (email_verified_at is not null or telegram_id is not null) as "emailVerified"
       from users where email = $1`,
      [input.email.toLowerCase()]
    );
    const user = result.rows[0];
    if (!user?.password_hash) throw badRequest("Invalid email or password");
    if (user.isBanned) throw forbidden("Account is banned");

    const ok = await bcrypt.compare(input.password, user.password_hash);
    if (!ok) throw badRequest("Invalid email or password");

    if (user.twoFactorEnabled) {
      const twoFactorToken = issueTwoFactorPendingToken(user.id);
      return res.json({ twoFactorRequired: true, twoFactorToken });
    }

    const session = await issueSession(user.id, user.role);
    setAuthCookies(res, session);
    delete user.password_hash;
    res.json({ user });
  })
);

router.post(
  "/2fa/verify",
  credentialRateLimit,
  asyncHandler(async (req, res) => {
    const input = twoFactorVerifySchema.parse(req.body);
    let userId: string;
    try {
      userId = verifyTwoFactorPendingToken(input.twoFactorToken);
    } catch {
      throw badRequest("Two-factor session has expired, log in again");
    }

    const result = await pool.query(
      `select id, email, display_name as "displayName", role, is_banned as "isBanned",
              (email_verified_at is not null or telegram_id is not null) as "emailVerified"
       from users where id = $1`,
      [userId]
    );
    const user = result.rows[0];
    if (!user) throw badRequest("Account not found");
    if (user.isBanned) throw forbidden("Account is banned");

    const valid = await verifyTwoFactorCode(userId, input.code);
    if (!valid) throw badRequest("Invalid two-factor code");

    const session = await issueSession(user.id, user.role);
    setAuthCookies(res, session);
    res.json({ user });
  })
);

router.post(
  "/telegram",
  credentialRateLimit,
  asyncHandler(async (req, res) => {
    const input = telegramSchema.parse(req.body);
    verifyTelegramAuth(input);

    const telegramId = String(input.id);
    const displayName = input.username ?? input.first_name ?? telegramId;
    const email = `tg_${telegramId}@telegram.local`;

    // Upsert-by-telegram_id and the mandatory wallet commit atomically, mirroring email
    // registration; the session is only issued for a fully committed account.
    const user = await inTx(async (client) => {
      const result = await client.query(
        `insert into users(email, display_name, role, telegram_id)
         values ($1, $2, 'user', $3)
         on conflict (telegram_id) do update set display_name = excluded.display_name
         returning id, email, display_name as "displayName", role,
                   (email_verified_at is not null or telegram_id is not null) as "emailVerified"`,
        [email, displayName, telegramId]
      );
      const created = result.rows[0];
      await client.query(
        `insert into wallets(user_id, currency) values ($1, 'UAH') on conflict (user_id, currency) do nothing`,
        [created.id]
      );
      return created;
    });
    const session = await issueSession(user.id, user.role);
    setAuthCookies(res, session);
    res.json({ user });
  })
);

router.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const refreshToken = req.cookies?.[REFRESH_COOKIE];
    if (!refreshToken) throw new ApiError(401, "Missing refresh token", "unauthorized");

    const redis = getRedis();
    if (!redis) throw serviceUnavailable("Sessions are unavailable right now, try again shortly");

    const tokenHash = hashRefreshToken(refreshToken);
    let userId: string | null;
    try {
      userId = await redis.get(`refresh:${tokenHash}`);
    } catch (error) {
      // A connection blip is not the same thing as "this token is invalid" - don't clear
      // cookies or sign the user out over it, just ask the client to retry shortly.
      logger.warn({ error }, "refresh_token_lookup_failed_redis_unavailable");
      throw serviceUnavailable("Sessions are unavailable right now, try again shortly");
    }

    if (!userId) {
      clearAuthCookies(res);
      throw new ApiError(401, "Refresh token is invalid or expired", "refresh_token_invalid");
    }

    const result = await pool.query(
      `select id, email, display_name as "displayName", role, is_banned as "isBanned",
              (email_verified_at is not null or telegram_id is not null) as "emailVerified"
       from users where id = $1`,
      [userId]
    );
    const user = result.rows[0];
    if (!user) {
      clearAuthCookies(res);
      throw new ApiError(401, "Account is unavailable", "unauthorized");
    }
    if (user.isBanned) {
      clearAuthCookies(res);
      throw forbidden("Account is banned");
    }

    // Issue the replacement session *before* revoking the one being redeemed: if anything
    // below fails, the caller's existing refresh token must remain usable rather than
    // leaving them with no valid session at all.
    const session = await issueSession(user.id, user.role);
    if (env.REFRESH_ROTATION_ENABLED) {
      await revokeRefreshToken(refreshToken, user.id);
    }
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
  asyncHandler(async (req: AuthedRequest, res) => {
    const refreshToken = req.cookies?.[REFRESH_COOKIE];
    await revokeSession(req.sessionId, req.user.id);
    await revokeRefreshToken(refreshToken, req.user.id);

    clearAuthCookies(res);
    res.status(204).send();
  })
);

router.post(
  "/logout-all",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    await revokeAllUserSessions(req.user.id);
    clearAuthCookies(res);
    res.status(204).send();
  })
);

router.post(
  "/verify-email/request",
  authenticate,
  emailVerificationRateLimit,
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
    const { link, sendPromise } = await createAndSendVerificationEmail(user, getRequestLocale(req));

    if (env.NODE_ENV === "production") {
      // Unlike registration, this is an explicit user action waiting on an email - a
      // broken/unconfigured Resend setup should surface as a real error here, not a
      // silent "sent" (sendEmail resolves false rather than throwing when RESEND_API_KEY
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
  emailVerificationRateLimit,
  asyncHandler(async (req, res) => {
    const input = emailVerifyConfirmSchema.parse(req.body);
    const userId = await consumeEmailVerificationToken(input.token);
    await pool.query(`update users set email_verified_at = now() where id = $1 and email_verified_at is null`, [userId]);
    res.json({ status: "verified" });
  })
);

router.post(
  "/password/forgot",
  passwordResetRateLimit,
  asyncHandler(async (req, res) => {
    const input = passwordForgotSchema.parse(req.body);
    const result = await pool.query(`select id, email from users where email = $1`, [input.email.toLowerCase()]);
    const user = result.rows[0];

    // Always respond the same way whether or not the account exists, so this endpoint
    // can't be used to enumerate registered emails.
    if (user) {
      const locale = getRequestLocale(req);
      const token = await createPasswordResetToken(user.id);
      const link = `${env.FRONTEND_URL}/${locale}/reset-password?token=${token}`;
      fireAndForget(sendPasswordResetEmail(user, link, locale), "password_reset_email_failed");
    }
    res.json({ status: "sent" });
  })
);

router.post(
  "/password/reset",
  passwordResetRateLimit,
  asyncHandler(async (req, res) => {
    const input = passwordResetSchema.parse(req.body);
    const userId = await consumePasswordResetToken(input.token);
    const passwordHash = await bcrypt.hash(input.password, 12);
    await pool.query(`update users set password_hash = $2, updated_at = now() where id = $1`, [userId, passwordHash]);
    // The password changed via an out-of-band email link, not from inside any active
    // session - every existing session (this device or any other) must re-authenticate.
    await revokeAllUserSessions(userId);
    res.json({ status: "reset" });
  })
);

// One-time WebSocket connection ticket (see ws-ticket.service.ts). Authenticated +
// CSRF-protected (global middleware) + rate limited; the ticket carries the caller's
// user/session identity to the WS handshake on a possibly different domain.
router.post(
  "/ws-ticket",
  authenticate,
  wsTicketRateLimit,
  asyncHandler(async (req: AuthedRequest, res) => {
    const { ticket, expiresInSeconds } = await issueWsTicket({
      userId: req.user.id,
      jti: req.sessionId ?? "",
      emailVerified: req.user.emailVerified
    });
    res.status(201).json({ ticket, expiresInSeconds });
  })
);

export default router;
