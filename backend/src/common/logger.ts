import pino from "pino";
import { env } from "../config/env.js";

export const logger = pino({
  level: env.NODE_ENV === "production" ? "info" : "debug",
  base: { service: "marketplace-api" },
  redact: ["req.headers.authorization", "password", "password_hash", "*.password", "*.token"]
});
