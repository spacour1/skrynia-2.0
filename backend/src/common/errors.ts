import type { NextFunction, Request, RequestHandler, Response } from "express";
import * as Sentry from "@sentry/node";
import { logger } from "./logger.js";
import { httpErrorsTotal } from "./metrics.js";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "api_error"
  ) {
    super(message);
  }
}

export function notFound(message = "Resource not found") {
  return new ApiError(404, message, "not_found");
}

export function forbidden(message = "Forbidden") {
  return new ApiError(403, message, "forbidden");
}

export function badRequest(message = "Invalid request") {
  return new ApiError(400, message, "bad_request");
}

export function conflict(message = "Conflict") {
  return new ApiError(409, message, "conflict");
}

export function unauthorized(message = "Unauthorized") {
  return new ApiError(401, message, "unauthorized");
}

export function serviceUnavailable(message = "Service temporarily unavailable") {
  return new ApiError(503, message, "service_unavailable");
}

export function asyncHandler(
  handler: (req: any, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}

function sendError(req: Request, res: Response, status: number, code: string, message: string, details?: unknown) {
  const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : req.path;
  if (status >= 400) {
    httpErrorsTotal.labels(req.method, route, String(status), code).inc();
  }
  return res.status(status).json({
    error: {
      code,
      message,
      details: details ?? undefined,
      traceId: req.traceId
    }
  });
}

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction) {
  if (error instanceof ApiError) {
    return sendError(req, res, error.status, error.code, error.message);
  }

  if (error && typeof error === "object" && "code" in error) {
    const pgError = error as { code?: string; constraint?: string; detail?: string };
    if (pgError.code === "23505") {
      if (pgError.constraint === "users_email_key") {
        return sendError(req, res, 409, "conflict", "An account with this email already exists");
      }
      return sendError(req, res, 409, "conflict", "A record with these unique fields already exists", {
        constraint: pgError.constraint
      });
    }
    if (pgError.code === "23503") {
      return sendError(req, res, 400, "invalid_reference", "Referenced resource does not exist");
    }
    if (pgError.code === "23514") {
      return sendError(req, res, 400, "constraint_violation", "Request violates a business constraint");
    }
  }

  if (error && typeof error === "object" && "issues" in error) {
    return sendError(req, res, 400, "validation_error", "Validation failed", error);
  }

  Sentry.captureException(error);
  logger.error({ traceId: req.traceId, error }, "unhandled_error");
  return sendError(req, res, 500, "internal_error", "Internal server error");
}
