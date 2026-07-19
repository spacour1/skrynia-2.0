import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const DEV_TWO_FACTOR_ENCRYPTION_KEY =
  "6465762d74776f2d666163746f722d656e6372797074696f6e2d6b65792d3031";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().optional(),
  PG_POOL_MAX: z.coerce.number().int().min(1).max(200).default(20),
  JWT_SECRET: z.string().min(24).default("dev-secret-change-me-for-production"),
  TWO_FACTOR_ENCRYPTION_KEY: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/, "TWO_FACTOR_ENCRYPTION_KEY must be 64 hexadecimal characters")
    .default(DEV_TWO_FACTOR_ENCRYPTION_KEY),
  TWO_FACTOR_ENCRYPTION_KEY_VERSION: z.coerce.number().int().min(1).default(1),
  ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().min(1).default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).default(90),
  // Reserved for a future opt-in "stay signed in on this device" toggle; until that ships,
  // every login is persistent and REFRESH_TOKEN_TTL_DAYS alone governs session lifetime.
  SESSION_REMEMBER_ME_DAYS: z.coerce.number().int().min(1).default(90),
  REFRESH_ROTATION_ENABLED: z.coerce.boolean().default(true),
  COOKIE_DOMAIN: z.string().optional(),
  FRONTEND_URL: z.string().default("http://localhost:3000"),
  // Comma-separated extra origins allowed to open WebSocket connections (besides FRONTEND_URL).
  ADDITIONAL_ALLOWED_ORIGINS: z.string().default(""),
  PLATFORM_FEE_BPS: z.coerce.number().int().min(500).max(1500).default(1000),
  AUTO_RELEASE_HOURS: z.coerce.number().int().min(1).default(72),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  LOCAL_UPLOAD_DIR: z.string().default("uploads"),
  PUBLIC_BACKEND_URL: z.string().default("http://localhost:4000"),
  SENTRY_DSN: z.string().optional(),
  SENTRY_RELEASE: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).optional(),
  JOB_WORKER_ENABLED: z.coerce.boolean().default(true),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  LIQPAY_PUBLIC_KEY: z.string().optional(),
  LIQPAY_PRIVATE_KEY: z.string().optional(),
  LIQPAY_SERVER_URL: z.string().optional(),
  MONOBANK_TOKEN: z.string().optional(),
  MONOBANK_WEBHOOK_URL: z.string().optional(),
  MANUAL_PAYMENT_CARD_NUMBER: z.string().optional(),
  MANUAL_PAYMENT_RECEIVER_NAME: z.string().optional(),
  MANUAL_PAYMENT_BANK: z.string().optional(),
  WAYFORPAY_MERCHANT_ACCOUNT: z.string().optional(),
  WAYFORPAY_MERCHANT_SECRET_KEY: z.string().optional(),
  WAYFORPAY_SERVICE_URL: z.string().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  // Used to build the t.me/<username>?start=<token> deep link for the notification-linking
  // flow (separate from the Telegram login widget, which doesn't need a bot at all).
  TELEGRAM_BOT_USERNAME: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  // SMTP is intentionally not used: most PaaS hosts (Railway included) block outbound
  // SMTP ports (25/465/587) at the network level, which makes mail silently time out
  // regardless of credentials. Resend's HTTP API runs over plain HTTPS (443) instead.
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("EscrowMarket <onboarding@resend.dev>"),
  // Twilio Verify handles phone-number OTP codes - same "warn, don't fail startup" treatment
  // as Resend above, since phone verification is optional everywhere except wallet withdrawal.
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_VERIFY_SERVICE_SID: z.string().optional(),
  // Trust N proxy hops for X-Forwarded-For (set to 1 behind Railway/Fly/Cloudflare).
  // Without this, all requests behind a reverse proxy appear to share one IP and rate
  // limiting will incorrectly apply a single bucket to all users.
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  // Per-minute limits per unique key (user id or IP).
  // In-memory store: limits are per-replica, not global across API instances.
  // For global limiting across replicas, add a Redis store (rate-limit-redis).
  PUBLIC_READ_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(10).default(600),
  API_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(10).default(300),
  WRITE_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(60),
  AUTH_RATE_LIMIT_PER_15MIN: z.coerce.number().int().min(1).default(20),
  ANONYMOUS_WRITE_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).optional(),
  CREDENTIAL_RATE_LIMIT_PER_15MIN: z.coerce.number().int().min(1).optional(),
  CREDENTIAL_RATE_LIMIT_PER_IDENTITY_15MIN: z.coerce.number().int().min(1).optional(),
  AUTHENTICATED_WRITE_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).optional(),
  AUTHENTICATED_WRITE_RATE_LIMIT_PER_IP: z.coerce.number().int().min(1).optional(),
  WS_TICKET_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(30),
  WS_TICKET_RATE_LIMIT_PER_IP: z.coerce.number().int().min(1).default(120),
  WS_MAX_BUFFERED_BYTES: z.coerce.number().int().min(1024).default(1024 * 1024),
  WS_MAX_ROOMS_PER_CONNECTION: z.coerce.number().int().min(1).max(1000).default(50),
  PHONE_OTP_RATE_LIMIT_PER_15MIN: z.coerce.number().int().min(1).default(10),
  PHONE_OTP_RATE_LIMIT_PER_IP_15MIN: z.coerce.number().int().min(1).default(30),
  EMAIL_VERIFICATION_RATE_LIMIT_PER_15MIN: z.coerce.number().int().min(1).default(10),
  EMAIL_VERIFICATION_RATE_LIMIT_PER_IP_15MIN: z.coerce.number().int().min(1).default(30),
  PASSWORD_RESET_RATE_LIMIT_PER_15MIN: z.coerce.number().int().min(1).default(10),
  PASSWORD_RESET_RATE_LIMIT_PER_IP_15MIN: z.coerce.number().int().min(1).default(30),
  WEBHOOK_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(60),
  METRICS_USER: z.string().default("metrics"),
  METRICS_PASSWORD: z.string().default("dev-metrics-password-change-me"),
  // Lets the dev/test payment-simulation endpoints (success/failure/wait_accept) run in a
  // deployed-but-not-quite-production environment (e.g. a staging demo) without flipping
  // NODE_ENV away from "production". Defaults closed everywhere else stays disabled.
  ENABLE_TEST_PAYMENTS: z.coerce.boolean().default(false)
}).superRefine((value, ctx) => {
  if (value.NODE_ENV !== "production") return;

  if (value.JWT_SECRET === "dev-secret-change-me-for-production") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["JWT_SECRET"],
      message: "JWT_SECRET must be set to a real secret in production"
    });
  }

  if (value.TWO_FACTOR_ENCRYPTION_KEY === DEV_TWO_FACTOR_ENCRYPTION_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["TWO_FACTOR_ENCRYPTION_KEY"],
      message: "TWO_FACTOR_ENCRYPTION_KEY must be set to a unique 32-byte key in production"
    });
  }

  if (value.METRICS_PASSWORD === "dev-metrics-password-change-me") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["METRICS_PASSWORD"],
      message: "METRICS_PASSWORD must be set to a real secret in production"
    });
  }

  const hasLiqpay = Boolean(value.LIQPAY_PUBLIC_KEY && value.LIQPAY_PRIVATE_KEY);
  const hasMonobank = Boolean(value.MONOBANK_TOKEN);
  const hasWayforpay = Boolean(value.WAYFORPAY_MERCHANT_ACCOUNT && value.WAYFORPAY_MERCHANT_SECRET_KEY);
  const hasManual = Boolean(value.MANUAL_PAYMENT_CARD_NUMBER && value.MANUAL_PAYMENT_RECEIVER_NAME);

  if (!hasLiqpay && !hasMonobank && !hasWayforpay && !hasManual) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["LIQPAY_PUBLIC_KEY"],
      message:
        "No real payment provider is configured for production (need LiqPay, Monobank, WayForPay, or manual transfer credentials)"
    });
  }

});

const parsedEnv = schema.parse(process.env);

// Keep the old aggregate knobs as fallbacks so existing deployments retain their
// effective ceilings while operators migrate to the separated limiter configuration.
export const env = {
  ...parsedEnv,
  ANONYMOUS_WRITE_RATE_LIMIT_PER_MIN:
    parsedEnv.ANONYMOUS_WRITE_RATE_LIMIT_PER_MIN ?? parsedEnv.WRITE_RATE_LIMIT_PER_MIN,
  CREDENTIAL_RATE_LIMIT_PER_15MIN:
    parsedEnv.CREDENTIAL_RATE_LIMIT_PER_15MIN ?? parsedEnv.AUTH_RATE_LIMIT_PER_15MIN,
  CREDENTIAL_RATE_LIMIT_PER_IDENTITY_15MIN:
    parsedEnv.CREDENTIAL_RATE_LIMIT_PER_IDENTITY_15MIN ??
    parsedEnv.CREDENTIAL_RATE_LIMIT_PER_15MIN ??
    parsedEnv.AUTH_RATE_LIMIT_PER_15MIN,
  AUTHENTICATED_WRITE_RATE_LIMIT_PER_MIN:
    parsedEnv.AUTHENTICATED_WRITE_RATE_LIMIT_PER_MIN ?? parsedEnv.WRITE_RATE_LIMIT_PER_MIN,
  AUTHENTICATED_WRITE_RATE_LIMIT_PER_IP:
    parsedEnv.AUTHENTICATED_WRITE_RATE_LIMIT_PER_IP ?? parsedEnv.API_RATE_LIMIT_PER_MIN
};

// Email is non-critical to keep the site running: warn instead of refusing to start, since
// verify-email/password-reset just no-op (see common/mailer.ts) until Resend is configured.
if (env.NODE_ENV === "production" && !env.RESEND_API_KEY) {
  console.warn("RESEND_API_KEY is not configured - verification and password-reset emails will not be sent");
}

if (env.NODE_ENV === "production" && !(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_VERIFY_SERVICE_SID)) {
  console.warn("Twilio Verify is not fully configured - phone verification codes will not be sent");
}
