import client from "prom-client";

client.collectDefaultMetrics({ prefix: "marketplace_" });

export const httpRequestDuration = new client.Histogram({
  name: "marketplace_http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status_code"] as const,
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5]
});

export const httpErrorsTotal = new client.Counter({
  name: "marketplace_http_errors_total",
  help: "HTTP error responses",
  labelNames: ["method", "route", "status_code", "code"] as const
});

export const paymentAttemptsTotal = new client.Counter({
  name: "marketplace_payment_attempts_total",
  help: "Payment attempts by provider and result",
  labelNames: ["provider", "result"] as const
});

export const jobProcessedTotal = new client.Counter({
  name: "marketplace_job_processed_total",
  help: "Processed background jobs",
  labelNames: ["queue", "name", "result"] as const
});

export const outboxEventsTotal = new client.Counter({
  name: "marketplace_outbox_events_total",
  help: "Domain outbox processing attempts by event type and result",
  labelNames: ["event_type", "result"] as const
});

export const outboxOldestPendingAgeSeconds = new client.Gauge({
  name: "marketplace_outbox_oldest_pending_age_seconds",
  help: "Age in seconds of the oldest pending or processing outbox event"
});

export const outboxPendingEvents = new client.Gauge({
  name: "marketplace_outbox_pending_events",
  help: "Number of pending or processing domain outbox events"
});

export const wsConnectionsActive = new client.Gauge({
  name: "marketplace_ws_connections_active",
  help: "Currently open WebSocket connections"
});

export const wsMessagesTotal = new client.Counter({
  name: "marketplace_ws_messages_total",
  help: "WebSocket messages received",
  labelNames: ["type"] as const
});

export const wsConnectionFailuresTotal = new client.Counter({
  name: "marketplace_ws_connection_failures_total",
  help: "WebSocket connections rejected at handshake (auth, ban, etc.)",
  labelNames: ["reason"] as const
});

export const wsSlowClientsTotal = new client.Counter({
  name: "marketplace_ws_slow_clients_total",
  help: "WebSocket clients closed because their outbound buffer exceeded the limit"
});

export const rateLimitHitsTotal = new client.Counter({
  name: "marketplace_rate_limit_hits_total",
  help: "Requests rejected by rate limiting (429)"
});

export const transactionRetryTotal = new client.Counter({
  name: "marketplace_transaction_retry_total",
  help: "SERIALIZABLE transaction attempts retried after 40001/40P01",
  labelNames: ["code"] as const
});

export const transactionRetryExhaustedTotal = new client.Counter({
  name: "marketplace_transaction_retry_exhausted_total",
  help: "SERIALIZABLE transactions that failed after exhausting retries",
  labelNames: ["code"] as const
});

export async function metricsText() {
  return client.register.metrics();
}
