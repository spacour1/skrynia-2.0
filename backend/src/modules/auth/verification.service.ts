import crypto from "node:crypto";
import { getRedis } from "../../common/redis.js";
import {
  badRequest,
  serviceUnavailable
} from "../../common/errors.js";
import { env } from "../../config/env.js";
import { pool } from "../../db/pool.js";
import { sendEmail, renderBrandedEmail } from "../../common/mailer.js";
import { logger } from "../../common/logger.js";
import { defaultLocale, type Locale } from "../../i18n/config.js";
import { getT } from "../../i18n/t.js";

export const EMAIL_VERIFY_TTL_SECONDS = 24 * 60 * 60;
export const PASSWORD_RESET_TTL_SECONDS = 60 * 60;
const RESEND_COOLDOWN_SECONDS = 60;
const RESEND_HOURLY_LIMIT = 5;
const TOKEN_RECORD_VERSION = 1 as const;
const RAW_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const EMAIL_VERIFY_PREFIX = "email_verify:";
const PASSWORD_RESET_PREFIX = "pwd_reset:";
const PASSWORD_RESET_ACTIVE_PREFIX = "pwd_reset_active:";

export type EmailVerificationTokenRecord = {
  version: typeof TOKEN_RECORD_VERSION;
  purpose: "email_verification";
  userId: string;
  expectedEmail: string;
  emailGeneration: number;
  expiresAt: number;
};

export type PasswordResetTokenRecord = {
  version: typeof TOKEN_RECORD_VERSION;
  purpose: "password_reset";
  userId: string;
  expectedEmail: string;
  emailGeneration: number;
  passwordGeneration: number;
  expiresAt: number;
};

const CONSUME_EMAIL_VERIFICATION_SCRIPT = `
local raw = redis.call("GET", KEYS[1])
if not raw then return false end

local decoded, record = pcall(cjson.decode, raw)
if not decoded
  or type(record) ~= "table"
  or record.version ~= tonumber(ARGV[1])
  or record.purpose ~= ARGV[2]
  or type(record.userId) ~= "string"
  or record.userId == ""
  or type(record.expectedEmail) ~= "string"
  or record.expectedEmail == ""
  or type(record.emailGeneration) ~= "number"
  or record.emailGeneration < 1
  or record.emailGeneration % 1 ~= 0
  or type(record.expiresAt) ~= "number"
  or record.expiresAt <= tonumber(ARGV[3])
then
  redis.call("DEL", KEYS[1])
  return false
end

redis.call("DEL", KEYS[1])
return raw
`;

const ISSUE_PASSWORD_RESET_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) == 1 then return 0 end

local incomingGeneration = tonumber(ARGV[5])
local previousValue = redis.call("GET", KEYS[2])
if previousValue then
  local separator = string.find(previousValue, ":", 1, true)
  local previousGeneration = 0
  local previousHash = previousValue
  if separator then
    previousGeneration = tonumber(string.sub(previousValue, 1, separator - 1)) or 0
    previousHash = string.sub(previousValue, separator + 1)
  end
  if previousGeneration >= incomingGeneration then return -1 end
  redis.call("DEL", ARGV[4] .. previousHash)
end

redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[2])
redis.call("SET", KEYS[2], ARGV[5] .. ":" .. ARGV[3], "EX", ARGV[2])
return 1
`;

const CONSUME_PASSWORD_RESET_SCRIPT = `
local raw = redis.call("GET", KEYS[1])
if not raw then return false end

local decoded, record = pcall(cjson.decode, raw)
if not decoded
  or type(record) ~= "table"
  or record.version ~= tonumber(ARGV[1])
  or record.purpose ~= ARGV[2]
  or type(record.userId) ~= "string"
  or string.len(record.userId) ~= 36
  or not string.match(record.userId, "^[0-9a-fA-F%-]+$")
  or type(record.expectedEmail) ~= "string"
  or record.expectedEmail == ""
  or type(record.emailGeneration) ~= "number"
  or record.emailGeneration < 1
  or record.emailGeneration % 1 ~= 0
  or type(record.passwordGeneration) ~= "number"
  or record.passwordGeneration < 1
  or record.passwordGeneration % 1 ~= 0
  or type(record.expiresAt) ~= "number"
then
  redis.call("DEL", KEYS[1])
  return false
end

local activeKey = ARGV[4] .. record.userId
local activeValue = redis.call("GET", activeKey)
local expectedActiveValue = tostring(record.passwordGeneration) .. ":" .. ARGV[5]
local isActive = activeValue == ARGV[5] or activeValue == expectedActiveValue
if record.expiresAt <= tonumber(ARGV[3]) then
  redis.call("DEL", KEYS[1])
  if isActive then redis.call("DEL", activeKey) end
  return false
end
if not isActive then
  redis.call("DEL", KEYS[1])
  return false
end

redis.call("DEL", KEYS[1])
redis.call("DEL", activeKey)
return raw
`;

const CANCEL_PASSWORD_RESET_ISSUE_SCRIPT = `
redis.call("DEL", KEYS[1])
if redis.call("GET", KEYS[2]) == ARGV[1] then
  redis.call("DEL", KEYS[2])
end
return 1
`;

const CHECK_RESEND_RATE_LIMIT_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) == 1 then return 1 end

local current = tonumber(redis.call("GET", KEYS[2]) or "0")
if current >= tonumber(ARGV[3]) then return 2 end

local count = redis.call("INCR", KEYS[2])
if redis.call("TTL", KEYS[2]) < 0 then
  redis.call("EXPIRE", KEYS[2], ARGV[2])
end
redis.call("SET", KEYS[1], "1", "EX", ARGV[1])
return 0
`;

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function requireRedis() {
  const redis = getRedis();
  if (!redis) {
    throw serviceUnavailable("Security links are temporarily unavailable");
  }
  return redis;
}

function invalidEmailVerificationToken(): never {
  throw badRequest("Verification link is invalid or expired");
}

function invalidPasswordResetToken(): never {
  throw badRequest("Reset link is invalid or expired");
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function parseJsonRecord(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function parseEmailVerificationRecord(
  raw: string,
  now: number
): EmailVerificationTokenRecord | null {
  const record = parseJsonRecord(raw);
  if (
    !record ||
    record.version !== TOKEN_RECORD_VERSION ||
    record.purpose !== "email_verification" ||
    typeof record.userId !== "string" ||
    record.userId.length === 0 ||
    typeof record.expectedEmail !== "string" ||
    record.expectedEmail.length === 0 ||
    normalizeEmail(record.expectedEmail) !== record.expectedEmail ||
    !isPositiveInteger(record.emailGeneration) ||
    !isPositiveInteger(record.expiresAt) ||
    record.expiresAt <= now
  ) {
    return null;
  }
  return record as EmailVerificationTokenRecord;
}

function parsePasswordResetRecord(
  raw: string,
  now: number
): PasswordResetTokenRecord | null {
  const record = parseJsonRecord(raw);
  if (
    !record ||
    record.version !== TOKEN_RECORD_VERSION ||
    record.purpose !== "password_reset" ||
    typeof record.userId !== "string" ||
    record.userId.length === 0 ||
    typeof record.expectedEmail !== "string" ||
    record.expectedEmail.length === 0 ||
    normalizeEmail(record.expectedEmail) !== record.expectedEmail ||
    !isPositiveInteger(record.emailGeneration) ||
    !isPositiveInteger(record.passwordGeneration) ||
    !isPositiveInteger(record.expiresAt) ||
    record.expiresAt <= now
  ) {
    return null;
  }
  return record as PasswordResetTokenRecord;
}

function emailVerificationKeyFromHash(tokenHash: string) {
  return `${EMAIL_VERIFY_PREFIX}${tokenHash}`;
}

function passwordResetKeyFromHash(tokenHash: string) {
  return `${PASSWORD_RESET_PREFIX}${tokenHash}`;
}

function passwordResetActiveKey(userId: string) {
  return `${PASSWORD_RESET_ACTIVE_PREFIX}${userId}`;
}

async function loadEmailVerificationIdentity(
  userId: string,
  expectedEmail?: string
) {
  const result = await pool.query<{
    email: string;
    emailGeneration: number;
  }>(
    `select email, email_generation as "emailGeneration"
     from users
     where id = $1`,
    [userId]
  );
  const user = result.rows[0];
  if (!user) throw badRequest("Account is unavailable");

  const authoritativeEmail = normalizeEmail(user.email);
  if (
    expectedEmail !== undefined &&
    normalizeEmail(expectedEmail) !== authoritativeEmail
  ) {
    throw badRequest("Email verification request is stale");
  }
  return {
    expectedEmail: authoritativeEmail,
    emailGeneration: user.emailGeneration
  };
}

async function issueEmailVerificationToken(
  userId: string,
  expectedEmail?: string
): Promise<{ token: string; record: EmailVerificationTokenRecord }> {
  const redis = requireRedis();
  const identity = await loadEmailVerificationIdentity(userId, expectedEmail);
  const record: EmailVerificationTokenRecord = {
    version: TOKEN_RECORD_VERSION,
    purpose: "email_verification",
    userId,
    expectedEmail: identity.expectedEmail,
    emailGeneration: identity.emailGeneration,
    expiresAt: Date.now() + EMAIL_VERIFY_TTL_SECONDS * 1000
  };

  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = crypto.randomBytes(32).toString("base64url");
      const stored = await redis.set(
        emailVerificationKeyFromHash(hashToken(token)),
        JSON.stringify(record),
        "EX",
        EMAIL_VERIFY_TTL_SECONDS,
        "NX"
      );
      if (stored === "OK") return { token, record };
    }
  } catch {
    throw serviceUnavailable("Security links are temporarily unavailable");
  }
  throw serviceUnavailable("Security links are temporarily unavailable");
}

export async function createEmailVerificationToken(
  userId: string,
  expectedEmail?: string
) {
  return (await issueEmailVerificationToken(userId, expectedEmail)).token;
}

/** Atomically consumes and validates an email-verification credential. */
export async function consumeEmailVerificationToken(
  token: string
): Promise<EmailVerificationTokenRecord> {
  if (!RAW_TOKEN_PATTERN.test(token)) invalidEmailVerificationToken();
  const redis = requireRedis();
  const now = Date.now();
  let raw: unknown;
  try {
    raw = await redis.eval(
      CONSUME_EMAIL_VERIFICATION_SCRIPT,
      1,
      emailVerificationKeyFromHash(hashToken(token)),
      String(TOKEN_RECORD_VERSION),
      "email_verification",
      String(now)
    );
  } catch {
    throw serviceUnavailable("Security links are temporarily unavailable");
  }
  if (typeof raw !== "string") invalidEmailVerificationToken();
  const record = parseEmailVerificationRecord(raw, now);
  return record ?? invalidEmailVerificationToken();
}

export async function issuePasswordResetToken(
  userId: string,
  expectedEmail?: string
): Promise<{ token: string; expectedEmail: string }> {
  const redis = requireRedis();
  const normalizedExpectedEmail =
    expectedEmail === undefined ? null : normalizeEmail(expectedEmail);

  // Commit the durable issuance epoch before talking to Redis. A newer request then
  // invalidates an older reset even if that older request already consumed its Redis
  // token and is still hashing. The Lua script independently ranks concurrent issuers
  // by this epoch, so a delayed older Redis call cannot supersede a newer credential.
  const result = await pool.query<{
    email: string;
    emailGeneration: number;
    passwordGeneration: number;
  }>(
    `update users
     set password_generation = password_generation + 1
     where id = $1
       and ($2::text is null or lower(email) = $2)
     returning email,
               email_generation as "emailGeneration",
               password_generation as "passwordGeneration"`,
    [userId, normalizedExpectedEmail]
  );
  const user = result.rows[0];
  if (!user) throw badRequest("Account is unavailable");

  const authoritativeEmail = normalizeEmail(user.email);
  const record: PasswordResetTokenRecord = {
    version: TOKEN_RECORD_VERSION,
    purpose: "password_reset",
    userId,
    expectedEmail: authoritativeEmail,
    emailGeneration: user.emailGeneration,
    passwordGeneration: user.passwordGeneration,
    expiresAt: Date.now() + PASSWORD_RESET_TTL_SECONDS * 1000
  };
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = crypto.randomBytes(32).toString("base64url");
      const tokenHash = hashToken(token);
      const activeValue = `${record.passwordGeneration}:${tokenHash}`;
      const stored = await redis.eval(
        ISSUE_PASSWORD_RESET_SCRIPT,
        2,
        passwordResetKeyFromHash(tokenHash),
        passwordResetActiveKey(userId),
        JSON.stringify(record),
        String(PASSWORD_RESET_TTL_SECONDS),
        tokenHash,
        PASSWORD_RESET_PREFIX,
        String(record.passwordGeneration)
      );
      if (stored === -1 || stored === "-1") {
        throw serviceUnavailable("Security links are temporarily unavailable");
      }
      if (stored !== 1 && stored !== "1") continue;

      const current = await pool.query<{
        email: string;
        emailGeneration: number;
        passwordGeneration: number;
      }>(
        `select email,
                email_generation as "emailGeneration",
                password_generation as "passwordGeneration"
         from users
         where id = $1`,
        [userId]
      );
      const identity = current.rows[0];
      if (
        identity &&
        normalizeEmail(identity.email) === record.expectedEmail &&
        identity.emailGeneration === record.emailGeneration &&
        identity.passwordGeneration === record.passwordGeneration
      ) {
        return { token, expectedEmail: authoritativeEmail };
      }

      await redis.eval(
        CANCEL_PASSWORD_RESET_ISSUE_SCRIPT,
        2,
        passwordResetKeyFromHash(tokenHash),
        passwordResetActiveKey(userId),
        activeValue
      );
      throw serviceUnavailable("Security links are temporarily unavailable");
    }
  } catch {
    throw serviceUnavailable("Security links are temporarily unavailable");
  }
  throw serviceUnavailable("Security links are temporarily unavailable");
}

export async function createPasswordResetToken(
  userId: string,
  expectedEmail?: string
) {
  return (await issuePasswordResetToken(userId, expectedEmail)).token;
}

/** Atomically consumes only the currently active reset credential for its user. */
export async function consumePasswordResetToken(
  token: string
): Promise<PasswordResetTokenRecord> {
  if (!RAW_TOKEN_PATTERN.test(token)) invalidPasswordResetToken();
  const redis = requireRedis();
  const now = Date.now();
  const tokenHash = hashToken(token);
  let raw: unknown;
  try {
    raw = await redis.eval(
      CONSUME_PASSWORD_RESET_SCRIPT,
      1,
      passwordResetKeyFromHash(tokenHash),
      String(TOKEN_RECORD_VERSION),
      "password_reset",
      String(now),
      PASSWORD_RESET_ACTIVE_PREFIX,
      tokenHash
    );
  } catch {
    throw serviceUnavailable("Security links are temporarily unavailable");
  }
  if (typeof raw !== "string") invalidPasswordResetToken();
  const record = parsePasswordResetRecord(raw, now);
  return record ?? invalidPasswordResetToken();
}

/**
 * Caps verification-email resends per user: no more than one every 60 seconds, and no
 * more than 5 per rolling hour. These security controls fail closed when Redis is absent
 * or a command fails; an unavailable limiter must not silently become an unlimited path.
 */
export async function checkResendRateLimit(userId: string) {
  const redis = requireRedis();
  let result: unknown;
  try {
    result = await redis.eval(
      CHECK_RESEND_RATE_LIMIT_SCRIPT,
      2,
      `email_verify_cooldown:${userId}`,
      `email_verify_hourly:${userId}`,
      String(RESEND_COOLDOWN_SECONDS),
      String(60 * 60),
      String(RESEND_HOURLY_LIMIT)
    );
  } catch {
    throw serviceUnavailable("Security links are temporarily unavailable");
  }
  if (result === 1 || result === "1") {
    throw badRequest("Please wait a minute before requesting another verification email");
  }
  if (result === 2 || result === "2") {
    throw badRequest("Too many verification emails requested, try again in an hour");
  }
  if (result !== 0 && result !== "0") {
    throw serviceUnavailable("Security links are temporarily unavailable");
  }
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
 * decide whether to await it). The authoritative database email is both token-bound and
 * used as the recipient, closing a stale-caller race around identity replacement.
 */
export async function createAndSendVerificationEmail(
  user: { id: string; email: string },
  locale: Locale = defaultLocale
) {
  const t = getT(locale);
  const { token, record } = await issueEmailVerificationToken(user.id, user.email);
  const link = `${env.FRONTEND_URL}/${locale}/verify-email?token=${token}`;
  const sendPromise = sendEmail({
    to: record.expectedEmail,
    subject: t("email.verify.subject"),
    text: t("email.verify.text", { link }),
    html: verificationEmailHtml(link, locale)
  });
  return { link, sendPromise };
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

export function sendPasswordResetEmail(
  user: { email: string },
  link: string,
  locale: Locale = defaultLocale
) {
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
