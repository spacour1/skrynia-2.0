import { getRedis } from "../../common/redis.js";
import { badRequest } from "../../common/errors.js";

const RESEND_COOLDOWN_SECONDS = 60;
// Lower than the email hourly limit (5) since each SMS costs real money through Twilio,
// unlike email which has a free tier - keeps a confused/bot user from burning through credit.
const RESEND_HOURLY_LIMIT = 3;

/** Mirrors verification.service.ts's checkResendRateLimit, scoped to phone codes instead of email links. */
export async function checkPhoneResendRateLimit(userId: string) {
  const redis = getRedis();
  if (!redis) return;

  const cooldownKey = `phone_verify_cooldown:${userId}`;
  const onCooldown = await redis.get(cooldownKey);
  if (onCooldown) throw badRequest("Please wait a minute before requesting another code");

  const hourlyKey = `phone_verify_hourly:${userId}`;
  const count = await redis.incr(hourlyKey);
  if (count === 1) await redis.expire(hourlyKey, 60 * 60);
  if (count > RESEND_HOURLY_LIMIT) throw badRequest("Too many codes requested, try again in an hour");

  await redis.set(cooldownKey, "1", "EX", RESEND_COOLDOWN_SECONDS);
}
