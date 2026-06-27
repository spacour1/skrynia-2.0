import crypto from "node:crypto";
import { getRedis } from "../../common/redis.js";
import { badRequest } from "../../common/errors.js";
import { env } from "../../config/env.js";
import { sendEmail } from "../../common/mailer.js";
import { logger } from "../../common/logger.js";

const EMAIL_VERIFY_TTL_SECONDS = 24 * 60 * 60;
const PASSWORD_RESET_TTL_SECONDS = 60 * 60;

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function requireRedis() {
  const redis = getRedis();
  if (!redis) throw badRequest("Sessions are unavailable right now, try again shortly");
  return redis;
}

export async function createEmailVerificationToken(userId: string) {
  const redis = requireRedis();
  const token = crypto.randomBytes(32).toString("base64url");
  await redis.set(`email_verify:${hashToken(token)}`, userId, "EX", EMAIL_VERIFY_TTL_SECONDS);
  return token;
}

/** Returns the user id the token was issued for, and deletes it so it can't be replayed. */
export async function consumeEmailVerificationToken(token: string) {
  const redis = requireRedis();
  const key = `email_verify:${hashToken(token)}`;
  const userId = await redis.get(key);
  if (!userId) throw badRequest("Verification link is invalid or expired");
  await redis.del(key);
  return userId;
}

export async function createPasswordResetToken(userId: string) {
  const redis = requireRedis();
  const token = crypto.randomBytes(32).toString("base64url");
  await redis.set(`pwd_reset:${hashToken(token)}`, userId, "EX", PASSWORD_RESET_TTL_SECONDS);
  return token;
}

export async function consumePasswordResetToken(token: string) {
  const redis = requireRedis();
  const key = `pwd_reset:${hashToken(token)}`;
  const userId = await redis.get(key);
  if (!userId) throw badRequest("Reset link is invalid or expired");
  await redis.del(key);
  return userId;
}

export function sendVerificationEmail(user: { id: string; email: string }) {
  return createEmailVerificationToken(user.id).then((token) => {
    const link = `${env.FRONTEND_URL}/verify-email?token=${token}`;
    return sendEmail({
      to: user.email,
      subject: "Confirm your email",
      text: `Confirm your email by visiting: ${link}`,
      html: `<p>Confirm your email by clicking the link below:</p><p><a href="${link}">${link}</a></p>`
    });
  });
}

/**
 * Fire-and-forget: SMTP latency (slow/misconfigured providers) must never make the caller
 * wait, since these run inline in user-facing request handlers like /register.
 */
export function fireAndForget(promise: Promise<unknown>, context: string) {
  promise.catch((error) => logger.error({ error }, context));
}
