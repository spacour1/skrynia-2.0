import type { RequestHandler } from "express";
import { ApiError } from "../errors.js";
import type { AuthedRequest } from "../types.js";

/** Must run after `authenticate`. Phone verification is optional everywhere except the
 * routes that explicitly apply this middleware (currently just wallet withdrawal). */
export const requirePhoneVerified: RequestHandler = (req, _res, next) => {
  const { user } = req as AuthedRequest;
  if (!user) return next(new ApiError(401, "Unauthorized", "unauthorized"));
  if (!user.phoneVerified) {
    return next(new ApiError(403, "Please verify your phone number to continue", "phone_not_verified"));
  }
  next();
};
