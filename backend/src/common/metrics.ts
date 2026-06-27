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

export async function metricsText() {
  return client.register.metrics();
}
