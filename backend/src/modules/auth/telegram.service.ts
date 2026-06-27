import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../../config/env.js";
import { badRequest } from "../../common/errors.js";

export type TelegramAuthPayload = {
  id: number | string;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number | string;
  hash: string;
};

const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60;

/** Per Telegram's login widget spec: all fields except `hash`, sorted by key, "key=value" joined by \n. */
function buildDataCheckString(payload: Omit<TelegramAuthPayload, "hash">) {
  return Object.entries(payload)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

/** Throws if the payload's signature is missing/invalid or the login is stale (replay protection). */
export function verifyTelegramAuth(payload: TelegramAuthPayload): void {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw badRequest("Telegram login is not configured on this server");
  }

  const { hash, ...rest } = payload;
  const dataCheckString = buildDataCheckString(rest);
  const secretKey = createHash("sha256").update(env.TELEGRAM_BOT_TOKEN).digest();
  const expectedHash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  const expectedBuf = Buffer.from(expectedHash);
  const actualBuf = Buffer.from(hash);
  if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
    throw badRequest("Invalid Telegram login signature");
  }

  const authDateSeconds = Number(payload.auth_date);
  const ageSeconds = Date.now() / 1000 - authDateSeconds;
  if (!Number.isFinite(authDateSeconds) || ageSeconds > MAX_AUTH_AGE_SECONDS || ageSeconds < -60) {
    throw badRequest("Telegram login data has expired");
  }
}
