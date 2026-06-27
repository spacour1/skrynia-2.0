import type { RequestHandler } from "express";
import { ApiError } from "../errors.js";
import type { Role } from "../types.js";

export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new ApiError(403, "Insufficient permissions", "forbidden"));
    }
    next();
  };
}
