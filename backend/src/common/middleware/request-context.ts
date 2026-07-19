import crypto from "node:crypto";
import type { RequestHandler } from "express";
import * as Sentry from "@sentry/node";
import { pool } from "../../db/pool.js";
import { env } from "../../config/env.js";
import { logger } from "../logger.js";
import { httpRequestDuration } from "../metrics.js";
import { redactSensitive } from "../audit-redact.js";
import { normalizedRequestEndpoint, requestPath, stripQueryString } from "../request-url.js";

const AUDITED_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const URL_FIELDS = new Set(["url", "uri", "path", "from", "to"]);

export function initErrorTracking() {
  if (!env.SENTRY_DSN) return;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    release: env.SENTRY_RELEASE ?? process.env.GITHUB_SHA ?? process.env.RAILWAY_DEPLOYMENT_ID,
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE ?? (env.NODE_ENV === "production" ? 0.1 : 0),
    integrations: [Sentry.httpIntegration()],
    beforeBreadcrumb: (breadcrumb) => sanitizeSentryBreadcrumb(breadcrumb),
    beforeSend: (event) => sanitizeSentryEvent(event),
    beforeSendTransaction: (event) => sanitizeSentryEvent(event)
  });
}

type SentryBreadcrumbLike = {
  data?: Record<string, unknown>;
};

type SentryEventLike = {
  request?: {
    url?: string;
    query_string?: unknown;
    data?: unknown;
    cookies?: unknown;
    headers?: Record<string, unknown>;
  };
  breadcrumbs?: SentryBreadcrumbLike[];
  transaction?: string;
};

function sanitizeUrlFields(value: unknown, depth = 0): unknown {
  if (!value || typeof value !== "object") return value;
  if (depth > 8) return "[truncated]";
  if (Array.isArray(value)) return value.map((item) => sanitizeUrlFields(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      URL_FIELDS.has(key.toLowerCase()) && typeof item === "string"
        ? stripQueryString(item)
        : sanitizeUrlFields(item, depth + 1)
    ])
  );
}

export function sanitizeSentryBreadcrumb<T extends SentryBreadcrumbLike>(breadcrumb: T): T {
  if (breadcrumb.data) {
    breadcrumb.data = redactSensitive(sanitizeUrlFields(breadcrumb.data)) as Record<string, unknown>;
  }
  return breadcrumb;
}

export function sanitizeSentryEvent<T extends SentryEventLike>(event: T): T {
  if (event.request) {
    if (event.request.url) event.request.url = stripQueryString(event.request.url);
    delete event.request.query_string;
    delete event.request.data;
    delete event.request.cookies;
    if (event.request.headers) {
      event.request.headers = redactSensitive(event.request.headers) as Record<string, unknown>;
    }
  }
  if (event.transaction) event.transaction = stripQueryString(event.transaction);
  event.breadcrumbs?.forEach((breadcrumb) => sanitizeSentryBreadcrumb(breadcrumb));
  return event;
}

export type RequestLogger = Pick<typeof logger, "info" | "warn">;

export function createRequestContext(requestLogger: RequestLogger = logger): RequestHandler {
  return (req, res, next) => {
    req.traceId = req.header("x-trace-id") || crypto.randomUUID();
    req.startTime = process.hrtime.bigint();
    res.setHeader("x-trace-id", req.traceId);

    // Attach traceId so every Sentry event links back to the structured log entry.
    Sentry.getCurrentScope().setTag("traceId", req.traceId);

    res.on("finish", () => {
      const path = requestPath(req);
      const endpoint = normalizedRequestEndpoint(req);
      const query = redactSensitive(req.query);
      const durationSeconds = Number(process.hrtime.bigint() - (req.startTime ?? process.hrtime.bigint())) / 1e9;
      httpRequestDuration.labels(req.method, endpoint, String(res.statusCode)).observe(durationSeconds);

      if (req.user?.id) Sentry.getCurrentScope().setUser({ id: req.user.id });

      requestLogger.info({
        traceId: req.traceId,
        method: req.method,
        path,
        route: endpoint,
        query,
        statusCode: res.statusCode,
        userId: req.user?.id,
        ip: req.ip,
        durationMs: Math.round(durationSeconds * 1000)
      }, "http_request");

      if (!AUDITED_METHODS.has(req.method)) return;
      // Request bodies are deliberately omitted. Params and query retain technical
      // context only after recursive key-based redaction.
      pool
        .query(
          `insert into audit_logs(trace_id, user_id, method, path, endpoint, status_code, ip_address, user_agent, action, request_body, metadata)
           values ($1, $2, $3, $4, $5, $6, nullif($7, '')::inet, $8, $9, null, $10)`,
          [
            req.traceId,
            req.user?.id ?? null,
            req.method,
            path,
            endpoint,
            res.statusCode,
            req.ip,
            req.get("user-agent") ?? null,
            `${req.method} ${endpoint}`,
            { params: redactSensitive(req.params), query }
          ]
        )
        .catch((error) => requestLogger.warn({ traceId: req.traceId, error }, "audit_log_failed"));
    });

    next();
  };
}

export const requestContext = createRequestContext();
