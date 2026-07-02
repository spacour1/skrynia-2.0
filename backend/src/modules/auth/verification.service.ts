import crypto from "node:crypto";
import { getRedis } from "../../common/redis.js";
import { badRequest } from "../../common/errors.js";
import { env } from "../../config/env.js";
import { sendEmail, renderBrandedEmail } from "../../common/mailer.js";
import { logger } from "../../common/logger.js";
import { defaultLocale, type Locale } from "../../i18n/config.js";
import { getT } from "../../i18n/t.js";

const EMAIL_VERIFY_TTL_SECONDS = 24 * 60 * 60;
const PASSWORD_RESET_TTL_SECONDS = 60 * 60;
const RESEND_COOLDOWN_SECONDS = 60;
const RESEND_HOURLY_LIMIT = 5;

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

/**
 * Caps verification-email resends per user: no more than one every 60 seconds, and no
 * more than 5 per rolling hour. Best-effort — if Redis is unreachable, token creation
 * itself will already fail with a clear error (see requireRedis above), so this just
 * skips limiting rather than masking that with a different error.
 */
export async function checkResendRateLimit(userId: string) {
  const redis = getRedis();
  if (!redis) return;

  const cooldownKey = `email_verify_cooldown:${userId}`;
  const onCooldown = await redis.get(cooldownKey);
  if (onCooldown) throw badRequest("Please wait a minute before requesting another verification email");

  const hourlyKey = `email_verify_hourly:${userId}`;
  const count = await redis.incr(hourlyKey);
  if (count === 1) await redis.expire(hourlyKey, 60 * 60);
  if (count > RESEND_HOURLY_LIMIT) throw badRequest("Too many verification emails requested, try again in an hour");

  await redis.set(cooldownKey, "1", "EX", RESEND_COOLDOWN_SECONDS);
}

function verificationEmailHtml(link: string, locale: Locale) {
  const t = getT(locale);
  return renderBrandedEmail({
    title: t("email.verify.title"),
    bodyHtml: t("email.verify.body"),
    ctaText: t("email.verify.cta"),
    ctaUrl: link,
    footerNote: t("email.verify.footer")
  });
}

/**
 * Creates a fresh token and returns both the link (so callers can expose
 * `debugVerificationUrl` outside production) and the in-flight send promise (so callers
 * decide whether to await it — register fires-and-forgets, the explicit resend endpoint
 * awaits it in production so a broken SMTP config surfaces as a real error).
 */
export function createAndSendVerificationEmail(user: { id: string; email: string }, locale: Locale = defaultLocale) {
  const t = getT(locale);
  return createEmailVerificationToken(user.id).then((token) => {
    // Localized link so the confirmation page opens in the user's language.
    const link = `${env.FRONTEND_URL}/${locale}/verify-email?token=${token}`;
    const sendPromise = sendEmail({
      to: user.email,
      subject: t("email.verify.subject"),
      text: t("email.verify.text", { link }),
      html: verificationEmailHtml(link, locale)
    });
    return { link, sendPromise };
  });
}

function passwordResetEmailHtml(link: string, locale: Locale) {
  const t = getT(locale);
  return renderBrandedEmail({
    title: t("email.passwordReset.title"),
    bodyHtml: t("email.passwordReset.body"),
    ctaText: t("email.passwordReset.cta"),
    ctaUrl: link,
    footerNote: t("email.passwordReset.footer")
  });
}

export function sendPasswordResetEmail(user: { email: string }, link: string, locale: Locale = defaultLocale) {
  const t = getT(locale);
  return sendEmail({
    to: user.email,
    subject: t("email.passwordReset.subject"),
    text: t("email.passwordReset.text", { link }),
    html: passwordResetEmailHtml(link, locale)
  });
}

/**
 * Fire-and-forget: SMTP latency (slow/misconfigured providers) must never make the caller
 * wait, since these run inline in user-facing request handlers like /register.
 */
export function fireAndForget(promise: Promise<unknown>, context: string) {
  promise.catch((error) => logger.error({ error }, context));
}
