# Observability

SKRYNIA ships with Prometheus metrics, Sentry error tracking, and PostHog product analytics. All three are opt-in and safe to leave unconfigured in local dev.

---

## Prometheus metrics

### Endpoint

```
GET /metrics
```

Protected by HTTP Basic Auth (`METRICS_USER` / `METRICS_PASSWORD`). Never expose without auth.

### Available metrics

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `marketplace_http_request_duration_seconds` | Histogram | method, route, status_code | Request latency per route |
| `marketplace_http_errors_total` | Counter | method, route, status_code, code | Error responses |
| `marketplace_payment_attempts_total` | Counter | provider, result | Payment outcomes per provider |
| `marketplace_job_processed_total` | Counter | queue, name, result | BullMQ job completions |
| `marketplace_ws_connections_active` | Gauge | — | Live WebSocket connections |
| `marketplace_ws_messages_total` | Counter | type | WS messages by type |
| `marketplace_ws_connection_failures_total` | Counter | reason | WS handshake rejections (auth, ban, etc.) |
| `marketplace_rate_limit_hits_total` | Counter | — | Requests returning 429 (any limiter) |
| `marketplace_*` (default) | Various | — | Node.js process metrics via prom-client defaults |

### Prometheus scrape config example

```yaml
scrape_configs:
  - job_name: marketplace-backend
    basic_auth:
      username: metrics
      password: <METRICS_PASSWORD>
    static_configs:
      - targets: ["api.your-domain.example:4000"]
    metrics_path: /metrics
    scrape_interval: 15s
```

### Grafana setup

1. Add Prometheus as a data source in Grafana.
2. Import a Node.js dashboard (e.g. Grafana ID 11159) as a starting point.
3. Build panels for the custom `marketplace_*` metrics above.

**Recommended panels:**
- Request rate: `rate(marketplace_http_request_duration_seconds_count[1m])`
- p95 latency: `histogram_quantile(0.95, rate(marketplace_http_request_duration_seconds_bucket[5m]))`
- p99 latency: `histogram_quantile(0.99, rate(marketplace_http_request_duration_seconds_bucket[5m]))`
- Error rate: `rate(marketplace_http_errors_total[1m])`
- 429 rate: `rate(marketplace_rate_limit_hits_total[1m])`
- Active WS connections: `marketplace_ws_connections_active`
- WS connect failures: `rate(marketplace_ws_connection_failures_total[5m])`
- Job failure rate: `rate(marketplace_job_processed_total{result="failed"}[5m])`

### Required env vars

```
METRICS_USER=metrics
METRICS_PASSWORD=<strong-secret>   # required in production (startup fails if default)
```

---

## Sentry

### Backend

Sentry is initialized in `backend/src/common/middleware/request-context.ts` only when `SENTRY_DSN` is set. The Express error handler (`Sentry.setupExpressErrorHandler`) is always registered but is a no-op without a DSN.

Context attached automatically: environment, release (from `SENTRY_RELEASE`, `GITHUB_SHA`, or `RAILWAY_DEPLOYMENT_ID`), HTTP method/URL, trace ID.

**Backend env vars:**

```
SENTRY_DSN=https://<key>@<host>/0
SENTRY_RELEASE=                     # optional; auto-detected from CI env
SENTRY_TRACES_SAMPLE_RATE=0.1       # 0.1 = 10% of requests traced
```

### Frontend

Sentry is configured in `frontend/sentry.client.config.ts` and `frontend/sentry.server.config.ts`. It activates only when `NEXT_PUBLIC_SENTRY_DSN` is set. The `next.config.mjs` wraps the build with `withSentryConfig` for source map upload when `SENTRY_AUTH_TOKEN` is provided.

Error ingestion is tunnelled through `/monitoring` to avoid ad-blocker interference.

**Frontend env vars:**

```
NEXT_PUBLIC_SENTRY_DSN=https://<key>@<host>/0
SENTRY_ORG=your-org-slug
SENTRY_PROJECT=skrynia-frontend
SENTRY_AUTH_TOKEN=                  # Sentry → Settings → Auth Tokens; needed for source maps
```

### Verification

1. Set `SENTRY_DSN` on the backend, restart.
2. Hit a non-existent route: `curl https://api.your-domain.example/nonexistent`
3. The 404 should appear in Sentry within ~30 s.
4. Set `NEXT_PUBLIC_SENTRY_DSN` in the frontend build, redeploy.
5. Check the Sentry Issues list for a test event from the frontend.

---

## PostHog product analytics

PostHog is integrated in the frontend only (`frontend/lib/posthog.ts`, `frontend/components/PostHogProvider.tsx`). It activates only when `NEXT_PUBLIC_POSTHOG_KEY` is set — no key = no requests, no overhead.

### Events tracked

| Event | Where | Properties |
|-------|-------|------------|
| `page_viewed` | Every route change | `path` |
| `product_viewed` | Product detail page on load | `product_id`, `category`, `game`, `product_type`, `delivery_type`, `price_cents`, `currency` |
| `search_submitted` | Nav search bar | `query` (search term) |
| `checkout_started` | "Buy Securely" click | `product_id` |
| `order_created` | After order POST succeeds | `order_id`, `product_id` |
| `payment_started` | Payment provider button click | `order_id`, `provider` |
| `seller_listing_created` | Listing published (not draft) | `product_id`, `game_id`, `section_id` |

### Privacy rules — never add to PostHog events

- Message bodies or chat content
- Payment credentials, card numbers, bank details
- Passwords or tokens
- Personal documents or private user data (email, phone, address)
- Order amounts or financial data

### Env vars

```
NEXT_PUBLIC_POSTHOG_KEY=phc_xxxxx
NEXT_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com   # EU cloud; US: https://app.posthog.com
```

### Setup steps

1. Create a project at `app.posthog.com`.
2. Copy the project API key (`phc_…`).
3. Set `NEXT_PUBLIC_POSTHOG_KEY` in the frontend build environment.
4. Deploy. Events appear under **Activity → Live Events** within seconds.

---

## Health check

The backend exposes two unauthenticated probes:

- `GET /health` returns `{"ok":true}` for process liveness.
- `GET /health/ready` returns `200` only when Redis publishing and subscription are ready.
  During degradation it returns `503` and reports Redis, subscriber, and presence state.

Example probe config for Railway:

```
Health Check Path: /health/ready
Health Check Timeout: 5s
```

Use `/health` for Kubernetes liveness and `/health/ready` for readiness. This keeps Redis
outages visible without restarting an otherwise healthy process.
