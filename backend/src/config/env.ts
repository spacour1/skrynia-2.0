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
});

export const env = schema.parse(process.env);
