# Playwright E2E

The Stage 12 suite runs against a production-shaped, isolated Docker Compose
topology:

- clean PostgreSQL and Redis volumes;
- one-shot migration and strictly test-gated deterministic admin seed jobs;
- separate API, BullMQ worker, and transactional-outbox processes;
- a production Next.js build;
- Chromium Playwright tests with one worker.

Run the complete suite from the repository root:

```bash
node e2e/scripts/run.mjs
```

The runner generates a unique Compose project and `E2E_RUN_ID`, waits for every
long-running service to report healthy, executes Playwright, and always runs
`docker compose down --volumes --remove-orphans`. Test users, products, orders,
messages, and reviews include the run id or a random suffix, so parallel or
previous runs cannot reuse business data.

## Payment and network safety

No real payment provider is called. Test capture routes require both:

```text
NODE_ENV=test
ENABLE_TEST_PAYMENTS=true
```

The opt-in is set only on the E2E API container. Migration, seed, worker, and
outbox containers explicitly inherit `ENABLE_TEST_PAYMENTS=false`. The Compose
network is internal, provider credentials are absent, and containers therefore
cannot accidentally reach public payment APIs.

The production Compose topology keeps the feature disabled. Do not add real
provider credentials to `docker-compose.e2e.yml`.

## Covered flows

- `golden.spec.ts`: registration, email verification, a fresh login, manual
  listing creation, public detail, first-message WebSocket ACK, checkout, test
  capture, start/deliver/confirm, and the first review all run through browser
  UI. The exact idempotency replay and duplicate-review attempt reuse the
  browser requests through the API helper. Adding the favorite is a real product
  detail button click, and its persisted result is then asserted on the browser
  favorites page.
- `dispute.spec.ts`: participant opens a dispute in browser UI, seller replies
  in the dedicated participant thread, admin sees those messages in browser UI,
  resolves the dispute, and terminal/immutable/read-only rules are asserted.
- `moderation.spec.ts`: warm public caches, block listing, public list/detail
  eviction, owner/admin preview, and reactivation.
- `session-security.spec.ts`: two browser contexts and WebSockets, cross-tab
  refresh fallback, offline logout recovery across reloads, password rotation,
  remote HTTP/refresh/WS revocation, and old/new password behavior.
- `reliability.spec.ts`: transient auth 500 without logout, aborted data request
  plus UI retry, currency switch preserving an unsaved draft, real category
  filter links, and opening a product link in a new Chromium tab.

API helpers are used for deterministic catalog/setup operations and invariant
assertions, including exact request replay where reproducing browser request
headers is the behavior under test.
Chat ACK, participant dispute interaction, admin dispute-message visibility,
password rotation, retry, currency draft, and link behavior execute through the
real frontend.

## Waiting and diagnostics

Tests use Playwright assertions and polling; there are no fixed sleeps. Compose
health checks gate startup. Chromium is deliberately configured with
`workers: 1` to avoid cross-flow contention.

On a failed test, Playwright retains:

- trace;
- screenshot;
- video;
- HTML report.

They are written under `e2e/test-results/` and
`e2e/playwright-report/`. The outer runner also writes
`stack-<run-id>.log` with PostgreSQL, Redis, migration, seed, API, worker,
outbox, and frontend logs before it removes containers and volumes. CI uploads
both directories even when the job fails.

To inspect the HTML report after a local failure:

```bash
cd e2e
npm run report
```

Validate the Compose model without starting it:

```bash
docker compose -f docker-compose.e2e.yml config --quiet
```
