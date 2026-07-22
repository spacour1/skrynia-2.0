# Current hardening baseline (after stages 0–7)

This is the baseline for the remaining production-hardening work. It replaces the
pre-cycle snapshot that was written before the completed hardening commits.

## Environment

- Branch / baseline HEAD: `codex/finish-big-plan` at `36ea677`
  (`refactor(orders): enforce centralized order state transitions`).
- Stages 0–7 are complete: domain/schema reconciliation, atomic account creation,
  DB-backed session revocation, transaction retries, resource-abuse protections,
  API contracts, and the centralized order state machine.
- The working tree is intentionally not described as production-ready: stages 8–13
  below still have implementation and verification work.

## Verified baseline checks

| Command | Result |
| --- | --- |
| `cd backend && npm ci` | PASS |
| `cd backend && npm run lint` | PASS |
| `cd backend && npm run build` | PASS |
| `cd backend && npm test` | PASS — 293/293 tests in 33 files (277.77s) |
| `cd frontend && npm ci` | PASS |
| `cd frontend && npm run typecheck` | PASS |
| `cd frontend && npm run i18n:check` | PASS — 0 errors, 25 baseline warnings |
| `cd frontend && npm test` | PASS — 6/6 (`node:test` realtime client) |
| `cd frontend && npm run build` | PASS |
| production Compose config | PASS |
| development Compose config | PASS |
| `docker compose build` | PASS |

These are recorded command results, not a claim that the application is ready for
production deployment. In particular, no Playwright, multilingual-search load, or
production payment-provider validation is represented by this baseline.

## Completed stages 0–7

| Stage | Status | Evidence |
| --- | --- | --- |
| 0 — baseline and invariants | complete | `da6571b fix(domain): reconcile marketplace lifecycle invariants` |
| 1 — atomic account creation | complete | `4ab7064 fix(auth): make account creation atomic` |
| 2 — versioned session revocation | complete | `192db73 fix(auth): enforce versioned session revocation` |
| 3 — transaction retry | complete | `cac7211 fix(db): retry serialization failures and deadlocks` |
| 4 — resource abuse and pagination | complete | `a515829`, `98096bb`, `0bab42d` |
| 5 — shared API contracts | complete | `8905964 refactor(api): centralize marketplace response contracts` |
| 6–7 — order-state-machine hardening | complete | `36ea677 refactor(orders): enforce centralized order state transitions` |

Existing completed capabilities that must not be reimplemented include transactional
outbox delivery/recovery, Redis realtime distribution, idempotency for orders/messages/
reviews, message ACKs, marketplace cache invalidation, encrypted 2FA lifecycle,
dispute recovery, storage ownership/quotas, audit sanitization, and public seller DTOs.

## Remaining work: stages 8–13

### Stage 8 — frontend test foundation

- Frontend test coverage is still one `tsx --test` realtime-client file; there is no
  Vitest + React Testing Library foundation for UI and failure-state tests.
- Add focused tests for authentication state, retry/error rendering, currency draft
  preservation, filter links, and keyboard/new-tab-safe product links.

### Stage 9 — frontend reliability

- Verify and complete degraded-auth behaviour: temporary network/429/5xx responses
  must not turn into a logout.
- Verify currency changes do not discard an in-progress draft or remount unrelated
  application state.
- Verify category navigation carries a real marketplace filter and product cards are
  accessible links that open correctly in a new tab.
- Add visible degraded/error/retry states where main marketplace queries fail.

### Stage 10 — production runtime and operations

- `backend/src/server.ts` still uses one startup entry point; add and verify orderly
  SIGTERM shutdown for HTTP, WebSocket, BullMQ/outbox, Redis, and PostgreSQL.
- Separate API and worker runtime entry points, retain explicit worker enablement, and
  make migrations a release step rather than an API-container startup side effect.
- Complete live/readiness probes with bounded dependency checks; verify container user,
  healthcheck, restart, and shutdown behaviour.

### Stage 11 — CI gates

- Current CI has backend migration/lint/test plus frontend typecheck/i18n/build, but no
  frontend test job, Playwright job, clean-DB migration smoke, Docker build job, audit
  gate, or secret scan.
- Add those checks only after their local workflows are reproducible and documented.

### Stage 12 — Playwright E2E

- No Playwright dependency, config, `e2e/` directory, dedicated Compose stack, browser
  fixtures, or CI job exists.
- Current dev Compose uses persistent local data rather than a clean isolated E2E DB;
  it has no deterministic browser accounts or E2E bootstrap.
- Mock payment routes exist, but are mounted in every environment and allowed in every
  non-production environment. They must be limited to an explicit test-only mode.
- Backend integration tests cover order/review idempotency, mock payment, cache
  invalidation, dispute recovery, session revocation, and WebSocket ACKs; none is a
  browser E2E proof.
- The frontend lacks participant dispute-message UI, so the planned seller dispute
  response cannot currently be performed as a normal browser action.

### Stage 13 — multilingual search

- `/marketplace/products?q=` uses English FTS plus `ILIKE`; no `pg_trgm` or `unaccent`
  migration, normalized representation, typo tolerance, or search performance plan exists.
- Main product search only considers title, description, game name, and category name.
  It omits game aliases, section, product type, server, and platform.
- Catalog aliases are stored and used by `/marketplace/suggest`, but are absent from the
  main products query; production seed data does not backfill the required multilingual
  aliases.
- Ranking is the normal product sort, not exact title → prefix → alias/game → trigram →
  full-text → popularity/recency. There are no required RU/UA/EN query fixtures or
  realistic-data `EXPLAIN ANALYZE` records.

## Non-goals and constraints

- Real LiqPay, Monobank, WayForPay, Resend, Twilio, Telegram, and other external
  integrations remain out of scope for automated validation; tests must use existing
  mocks only.
- Do not call the application production-ready until stages 8–13 have been implemented
  and their applicable checks have actually passed.
