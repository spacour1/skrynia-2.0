# Load Tests — k6

Load testing foundation for SKRYNIA Stage 1 scalability targets:
- 10 k online users
- 500–1 500 API RPS
- 1 k–5 k WebSocket connections

## Prerequisites

Install k6: https://k6.io/docs/get-started/installation/

```bash
# macOS
brew install k6

# Windows (winget — recommended)
winget install k6.k6

# Windows (via Chocolatey)
choco install k6

# Without installing — Docker (cross-platform)
docker run --rm -i grafana/k6 run - < load-tests/scenarios/stage1-http.js
```

## Scenarios

| File | What it tests | Auth needed |
|------|--------------|-------------|
| `scenarios/browse.js` | Public marketplace browsing, product listing, product detail | No |
| `scenarios/auth.js` | Login + session validation | Yes (test account) |
| `scenarios/websocket.js` | WebSocket connection handling (anonymous + authenticated) | Optional |
| `scenarios/order-flow.js` | Full order create → pay (mock) flow | Yes (buyer account) |
| `scenarios/stage1-http.js` | Stage 1 public browsing at 500–1500 RPS (ramping-arrival-rate) | No |
| `scenarios/stage1-ws.js` | Stage 1 WebSocket: 1k/3k/5k authenticated connections (ramping-vus) | Yes (test account) |
| `scenarios/stage1-mixed.js` | Stage 1 realistic blend: 70% browse / 20% auth / 10% checkout-read | Yes (test account) |

## Running locally

```bash
# Browse (anonymous, safe to run against dev)
k6 run load-tests/scenarios/browse.js

# Browse against a specific URL
k6 run -e BASE_URL=https://staging.example.com load-tests/scenarios/browse.js

# Auth smoke (requires test account)
k6 run \
  -e BASE_URL=https://staging.example.com \
  -e TEST_EMAIL=loadtest@example.com \
  -e TEST_PASSWORD=loadtest123 \
  load-tests/scenarios/auth.js

# WebSocket (anonymous connections — server will 1008 them, test verifies graceful close)
k6 run \
  -e BASE_URL=http://localhost:4000 \
  -e WS_URL=ws://localhost:4000/ws \
  load-tests/scenarios/websocket.js

# Order flow (STAGING ONLY — never production)
k6 run \
  -e BASE_URL=https://staging.example.com \
  -e TEST_BUYER_EMAIL=buyer@example.com \
  -e TEST_BUYER_PASSWORD=buyerpassword \
  -e TEST_PRODUCT_ID=<product-uuid> \
  load-tests/scenarios/order-flow.js
```

## Stage 1 scenarios (production-scale load)

All Stage 1 scenarios are configurable via env vars and require a staging environment.

```bash
# Stage 1 HTTP — public marketplace at 1000 RPS for 5 min
k6 run \
  -e BASE_URL=https://staging.example.com \
  -e TARGET_RPS=1000 \
  -e RAMP_DURATION=2m \
  -e HOLD_DURATION=5m \
  load-tests/scenarios/stage1-http.js

# Stage 1 WebSocket — 1000 authenticated connections for 5 min
k6 run \
  -e BASE_URL=https://staging.example.com \
  -e WS_URL=wss://staging.example.com/ws \
  -e TEST_EMAIL=loadtest@example.com \
  -e TEST_PASSWORD=Password123! \
  -e TARGET_VU=1000 \
  -e RAMP_DURATION=2m \
  -e HOLD_DURATION=5m \
  load-tests/scenarios/stage1-ws.js

# Stage 1 mixed — 70/20/10 browse/auth/checkout blend, 500 total VUs
k6 run \
  -e BASE_URL=https://staging.example.com \
  -e TEST_EMAIL=loadtest@example.com \
  -e TEST_PASSWORD=Password123! \
  -e TARGET_VU=500 \
  -e RAMP_DURATION=2m \
  -e HOLD_DURATION=5m \
  load-tests/scenarios/stage1-mixed.js

# Same via Docker (no k6 install required)
docker run --rm \
  -e BASE_URL=https://staging.example.com \
  -e TARGET_RPS=500 \
  -v "$(pwd)/load-tests:/load-tests" \
  grafana/k6 run /load-tests/scenarios/stage1-http.js
```

### Stage 1 acceptance criteria

| Metric | Target |
|--------|--------|
| `http_req_failed` | < 5% |
| `http_req_duration{p95}` | < 1500 ms |
| `rate_limited_responses` | < 100 per test run |
| `ws_connect_errors` | 0 at 1k, < 1% at 5k |

## ⚠️ Safety rules

1. **Never run `order-flow.js` against production.** It creates real orders.
2. **Never run any scenario against production without explicit load-testing approval.** Use a staging environment.
3. `order-flow.js` requires `ENABLE_TEST_PAYMENTS=true` on the backend — production has this `false`.
4. Auth scenarios require pre-seeded test accounts — do not expose real user credentials.
5. Start with low VU counts and ramp up gradually. The default stages are intentionally conservative.

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BASE_URL` | `http://localhost:4000` | Backend API base URL |
| `WS_URL` | `ws://localhost:4000/ws` | WebSocket endpoint |
| `TEST_EMAIL` | — | Test account email (auth / stage1-ws / stage1-mixed) |
| `TEST_PASSWORD` | — | Test account password |
| `TEST_BUYER_EMAIL` | — | Buyer email (order-flow scenario) |
| `TEST_BUYER_PASSWORD` | — | Buyer password |
| `TEST_PRODUCT_ID` | — | Active product UUID (order-flow scenario) |
| `TARGET_RPS` | `1500` | Peak RPS for stage1-http |
| `TARGET_VU` | `5000` | Peak VUs/connections for stage1-ws and stage1-mixed |
| `RAMP_DURATION` | `3m` | Ramp-up time for all Stage 1 scenarios |
| `HOLD_DURATION` | `10m` | Sustained load duration for all Stage 1 scenarios |

## Thresholds (defaults)

All scenarios inherit from `config.js`:

```
http_req_duration: p(95) < 2000ms, p(99) < 5000ms
http_req_failed: rate < 5%
```

Order flow has relaxed thresholds (`p(95) < 5000ms`) because checkout is DB-heavy.

## Interpreting results

k6 prints a summary table at the end. Key metrics:

- `http_req_duration` — request latency percentiles
- `http_req_failed` — error rate
- `ws_connecting` — WebSocket handshake latency
- `vus` — concurrent users at peak
- `iterations` — total completed VU iterations

For streaming output during the run, use:

```bash
k6 run --out json=results.json scenarios/browse.js
```

Import `results.json` into Grafana (via the k6 data source or a dashboard like Grafana ID 2587).
