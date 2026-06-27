import crypto from "node:crypto";
import type { RequestHandler } from "express";
import { ApiError } from "../errors.js";
import { CSRF_COOKIE } from "../cookies.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Routes that legitimately mutate state without an existing CSRF-protected session:
// auth bootstrap endpoints (no session cookie yet) and the LiqPay server-to-server webhook
// (an external POST that never carries our cookies in the first place).
const EXEMPT_PATHS = new Set(["/auth/login", "/auth/register", "/auth/telegram", "/payments/liqpay/callback"]);

function timingSafeEqual(a: string, b: string) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export const csrfProtection: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method) || EXEMPT_PATHS.has(req.path)) return next();

  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.headers["x-csrf-token"];

  if (
    typeof cookieToken !== "string" ||
    typeof headerToken !== "string" ||
    !cookieToken ||
    !timingSafeEqual(cookieToken, headerToken)
  ) {
    return next(new ApiError(403, "Invalid or missing CSRF token", "csrf_failed"));
  }

  next();
};
