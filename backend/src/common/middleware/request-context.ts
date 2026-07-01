import crypto from "node:crypto";
import type { RequestHandler } from "express";
import * as Sentry from "@sentry/node";
import { pool } from "../../db/pool.js";
import { env } from "../../config/env.js";
import { logger } from "../logger.js";
import { httpRequestDuration } from "../metrics.js";

const AUDITED_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const BODY_REDACTIONS = new Set(["password", "currentPassword", "newPassword", "token"]);

function cleanBody(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(cleanBody);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      BODY_REDACTIONS.has(key) ? "[redacted]" : cleanBody(item)
    ])
  );
}

export function initErrorTracking() {
  if (!env.SENTRY_DSN) return;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    release: env.SENTRY_RELEASE ?? process.env.GITHUB_SHA ?? process.env.RAILWAY_DEPLOYMENT_ID,
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE ?? (env.NODE_ENV === "production" ? 0.1 : 0),
    integrations: [Sentry.httpIntegration()],
  });
}

export const requestContext: RequestHandler = (req, res, next) => {
  req.traceId = req.header("x-trace-id") || crypto.randomUUID();
  req.startTime = process.hrtime.bigint();
  res.setHeader("x-trace-id", req.traceId);

  // Attach traceId so every Sentry event links back to the structured log entry.
  // Sentry.httpIntegration() sets up per-request async context; tags set here are
  // scoped to this request only when async context propagation is active.
  Sentry.getCurrentScope().setTag("traceId", req.traceId);

  res.on("finish", () => {
    const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : req.path;
    const durationSeconds = Number(process.hrtime.bigint() - (req.startTime ?? process.hrtime.bigint())) / 1e9;
    httpRequestDuration.labels(req.method, route, String(res.statusCode)).observe(durationSeconds);

    if (req.user?.id) Sentry.getCurrentScope().setUser({ id: req.user.id });

    logger.info({
      traceId: req.traceId,
      method: req.method,
      path: req.originalUrl,
      route,
      statusCode: res.statusCode,
      userId: req.user?.id,
      ip: req.ip,
      durationMs: Math.round(durationSeconds * 1000)
    }, "http_request");

    if (!AUDITED_METHODS.has(req.method)) return;
    pool
      .query(
        `insert into audit_logs(trace_id, user_id, method, path, endpoint, status_code, ip_address, user_agent, action, request_body, metadata)
         values ($1, $2, $3, $4, $5, $6, nullif($7, '')::inet, $8, $9, $10, $11)`,
        [
          req.traceId,
          req.user?.id ?? null,
          req.method,
          req.originalUrl,
          route,
          res.statusCode,
          req.ip,
          req.get("user-agent") ?? null,
          `${req.method} ${route}`,
          cleanBody(req.body) ?? null,
          { params: req.params, query: req.query }
        ]
      )
      .catch((error) => logger.warn({ traceId: req.traceId, error }, "audit_log_failed"));
  });

  next();
};
