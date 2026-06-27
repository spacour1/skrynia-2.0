import pino from "pino";
import { env } from "../config/env.js";

export const logger = pino({
  level: env.NODE_ENV === "production" ? "info" : "debug",
  base: { service: "marketplace-api" },
  redact: ["req.headers.authorization", "password", "password_hash", "*.password", "*.token"],
  // Error objects only auto-serialize (message/stack) under pino's special "err" key -
  // under any other key (this codebase logs `{ error }` everywhere) a plain Error
  // silently logs as "{}", since message/stack aren't its own enumerable properties.
  serializers: { error: pino.stdSerializers.err }
});
