import type { RequestHandler } from "express";
import { ApiError } from "../errors.js";
import type { AuthedRequest } from "../types.js";

/**
 * Must run after `authenticate`. Telegram-only accounts are already counted as verified
 * (computed server-side in the users query: email_verified_at is not null or telegram_id
 * is not null), so this only ever blocks real-email accounts that haven't clicked their
 * confirmation link yet.
 */
export const requireEmailVerified: RequestHandler = (req, _res, next) => {
  const { user } = req as AuthedRequest;
  if (!user) return next(new ApiError(401, "Unauthorized", "unauthorized"));
  if (!user.emailVerified) {
    return next(new ApiError(403, "Please verify your email to continue", "email_not_verified"));
  }
  next();
};
