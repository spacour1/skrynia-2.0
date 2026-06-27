import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().optional(),
  JWT_SECRET: z.string().min(24).default("dev-secret-change-me-for-production"),
  ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().min(1).default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).default(30),
  COOKIE_DOMAIN: z.string().optional(),
  FRONTEND_URL: z.string().default("http://localhost:3000"),
  PLATFORM_FEE_BPS: z.coerce.number().int().min(500).max(1500).default(1000),
  AUTO_RELEASE_HOURS: z.coerce.number().int().min(1).default(72),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  LOCAL_UPLOAD_DIR: z.string().default("uploads"),
  PUBLIC_BACKEND_URL: z.string().default("http://localhost:4000"),
  SENTRY_DSN: z.string().optional(),
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
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: z.coerce.boolean().default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().default("EscrowMarket <no-reply@escrowmarket.local>"),
  METRICS_USER: z.string().default("metrics"),
  METRICS_PASSWORD: z.string().default("dev-metrics-password-change-me")
}).superRefine((value, ctx) => {
  if (value.NODE_ENV !== "production") return;

  if (value.JWT_SECRET === "dev-secret-change-me-for-production") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["JWT_SECRET"],
      message: "JWT_SECRET must be set to a real secret in production"
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

  if (!value.SMTP_HOST) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["SMTP_HOST"],
      message: "SMTP_HOST must be configured in production so verification and password-reset emails can be sent"
    });
  }
});

export const env = schema.parse(process.env);
