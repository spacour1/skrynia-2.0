# Current hardening baseline (Stage 3 cycle)

Snapshot of `main` before the next production-hardening cycle. Supersedes the planning
assumptions in `docs/remaining-hardening-plan.md` — many items listed there as pending
have already been implemented (see the capability table below).

## Environment

- Branch: `main`
- HEAD SHA: `48f994d900dae2d13d9764f180b9266bd334cd46`
  (merge of PR #10 `docs/require-2fa-encryption-key`)
- Working tree: clean at baseline time
- Node.js: v24.18.0, npm: 11.16.0 (CI pins Node 20)
- Migrations: 35 SQL files, `1782518994595_initial-schema.sql` …
  `1783290900000_add-owned-storage-objects.sql`
- Backend scripts: `dev`, `build` (tsc), `start`, `migrate` (node-pg-migrate up),
  `migrate:create`, `migrate:down`, `seed`, `lint` (tsc --noEmit), `test` (vitest run),
  `test:watch`
- Frontend scripts: `dev`, `build`, `start`, `lint`, `typecheck`, `i18n:check`,
  `test` (single `tsx --test test/realtime-client.test.ts` file — no Vitest/RTL yet)

## Baseline check results

| Command | Result |
| --- | --- |
| `cd backend && npm ci` | PASS |
| `cd backend && npm run lint` | PASS (exit 0) |
| `cd backend && npm run build` | PASS (exit 0) |
| `backend migrate` against `marketplace_test` | PASS — all 35 migrations applied |
| `cd backend && npm test` | PASS — 218/218 tests in 23 files (204.98s) |
| `cd frontend && npm ci` | PASS |
| `cd frontend && npm run typecheck` | PASS (exit 0) |
| `cd frontend && npm run i18n:check` | PASS — 0 errors, 25 baseline warnings |
| `cd frontend && npm test` | PASS — 6/6 (node:test realtime-client) |
| `cd frontend && npm run build` | PASS (exit 0) |
| `docker compose config --quiet` (no secrets) | FAIL — required env guards fire (expected) |
| `docker compose config --quiet` (placeholder secrets) | PASS |
| `docker compose build` | PASS — backend + frontend images built (exit 0) |

## Capability table

| Capability | Planned | Implemented | Partial | Missing | Evidence |
| --- | --- | --- | --- | --- | --- |
| Transactional outbox | yes | yes | | | `modules/outbox/`, migration `1783290700000`, hardening-stage-2-progress Stage 9 |
| Stale outbox recovery | yes | yes | | | `outbox.worker.ts` stale-claim recovery, lock timestamps |
| BullMQ worker | yes | yes | | | `modules/jobs/queue.ts`, `JOB_WORKER_ENABLED` env toggle |
| Redis Pub/Sub realtime distribution | yes | yes | | | `modules/realtime/`, Stage 11 record, `REALTIME_CHANNEL` |
| Idempotency (orders/messages/reviews) | yes | yes | | | `modules/idempotency/`, migration `1783290800000`, Stage 10 record |
| Message ACK (clientMessageId) | yes | yes | | | `messages.client_message_id` partial unique index, Stage 5/10 records |
| Storage ownership (storage_objects) | yes | yes | | | migration `1783290900000`, `storage.service.ts`, last commit `dcb7538` |
| Upload quotas (daily/total bytes, concurrency) | yes | | | **yes** | no quota logic in `modules/storage/` (grep: 0 hits) |
| Temporary upload cleanup | yes | | partial | | `STORAGE_TEMP_TTL_HOURS` exists; verify cleanup job coverage in Stage 5 |
| Seller statistics (CTE, hasEnoughData) | yes | yes | | | Stage 8 record, `users.routes.ts` |
| Marketplace cache invalidation | yes | yes | | | Stage 1 record, marketplace cache service |
| 2FA lifecycle (encrypted, atomic) | yes | yes | | | migration `1783290300000`, Stage 2 record |
| Dispute recovery (resolving state, claims) | yes | yes | | | migration `1783290400000`, `dispute-resolution.service.ts` |
| Audit sanitization (no query secrets) | yes | yes | | | migration `1783290600000`, Stage 7 record |
| Public seller DTO | yes | yes | | | Stage 8 record (`PublicSellerDto`) |
| Shared enum/status definitions | yes | | | **yes** | no `ORDER_STATUSES`/`OrderStatus` anywhere in backend src; statuses are string literals |
| Order state machine (central transitions) | yes | | | **yes** | raw `update orders set status = ...` in `orders.routes.ts:257,312`, `test-payments.service.ts:27` |
| Session versioning (DB-backed revocation) | yes | | | **yes** | no `session_version` column; revocation is Redis-only (`session.service.ts`) |
| Atomic account creation | yes | | | **yes** | `auth.routes.ts:76-86` — user insert, wallet insert, session are separate queries |
| Transaction retry (40001/40P01) | yes | | | **yes** | no retry helper in `db/pool.ts` |
| Frontend auth degraded state | yes | | | **yes** | `auth-store.ts:63-67` — any hydrate error clears cached user |
| Currency without full remount | yes | | | **yes** | `providers.tsx:51` — `<div key={currencyVersion}>` remounts subtree |
| Frontend test foundation (Vitest+RTL) | yes | | | **yes** | only `tsx --test` single file |
| Graceful shutdown | yes | | | **yes** | `server.ts` — no SIGTERM/SIGINT handlers anywhere in src |
| Separate API/worker entrypoints | yes | | partial | | one `server.ts` for all; env toggles `JOB_WORKER_ENABLED`/`OUTBOX_WORKER_ENABLED`; compose has separate `worker` service on same image |
| Health live/ready split | yes | | partial | | `/health` + `/health/ready` (realtime only — no DB/Redis dependency checks, no timeout) |
| Migrations as release step | yes | | | **yes** | backend Dockerfile CMD runs `node-pg-migrate up` before server start |
| Docker non-root/healthcheck | yes | | | **yes** | both Dockerfiles run as root, no HEALTHCHECK, frontend copies dev node_modules |
| CI: frontend tests / docker build / migration smoke / audit / secret scan | yes | | | **yes** | `ci.yml` has backend (migrate+lint+test) and frontend (typecheck+i18n+build) only |
| Playwright E2E | yes | | | **yes** | no e2e directory or Playwright dependency |
| Multilingual search (pg_trgm/unaccent) | yes | | | **yes** | `marketplace-browse.routes.ts:192-199` — `to_tsvector('english', …)` + `ILIKE '%q%'`; no trgm/unaccent extensions |
| Bounded pagination on admin/dispute lists | yes | | | **yes** | dispute detail loads `limit: 200` messages without cursor (`disputes.routes.ts:252`) |
| WS control-frame limits | yes | | partial | | room cap + buffered-bytes cap exist; no join/frame rate limit or concurrent-handler bound |

## Confirmed domain-invariant drift (input for Stage 1)

1. `docs/product-behavior.md:9,46` and `AGENTS.md` use order status `created`; the DB
   CHECK uses `pending` (initial-schema.sql:139) and later adds `canceled`
   (migration `1782658636398`).
2. Actual `orders.status` set: `pending, paid, in_progress, delivered, completed,
   disputed, refunded, canceled`.
3. `docs/product-behavior.md:27,61` documents platform fee as **ceil**; code uses
   `Math.floor` (`ledger.service.ts:58-60`). Ledger entries already exist under the
   floor rule — code is the source of truth; docs must change, not the formula.
4. `docs/product-behavior.md:40` says "Admin or moderator resolves" disputes; the
   endpoints require `admin` only (`disputes.routes.ts:193,211,233,263`).
5. `docs/product-behavior.md:53,122` references `wallets.balance_cents`; actual schema
   has `available_cents` + `escrow_cents` (initial-schema.sql:32-33).
6. `products.delivery_type` CHECK is already `('manual','instant')` — no `service`
   backfill needed. But `game_sections.allowed_delivery_types` still allows
   `'service'` in its array constraint (migration `1783289701862:41-42`) and
   `catalog-sections.service.ts:47` defaults a section field to `'service'` — needs
   reconciliation in Stage 1.
7. Roles: `user, moderator, admin` (migration `1782687000001`) — matches
   `common/types.ts`. Frontend duplicates the type in `lib/api.ts:9`.
8. `messages.kind`: `user, system` (migration `1782687000002`) — matches plan.
9. Dispute status: `open, resolving, resolved` (migration `1783290200000`); decision
   values `release | refund` (initial-schema.sql:344).
10. Catalog lifecycle: groups/items/sections use `draft, active, hidden, archived,
    deleted`; section schemas use `draft, active, archived` — two distinct enums that
    must not be merged.
11. Frontend order/product statuses are untyped `status: string` (`lib/api.ts:119`)
    with literals scattered across pages.

## Other confirmed defects feeding later stages

- Registration (email + Telegram): user insert, wallet insert, and session issuance are
  separate operations without a transaction; duplicate email surfaces as a raw unique
  violation (`auth.routes.ts:69-102,166-191`).
- Password reset revokes sessions only in Redis, non-strict — Redis failure logs and
  returns success while old sessions keep working (`auth.routes.ts:351-364`,
  `session.service.ts:99-147`).
- `issueSession` performs 6 separate Redis commands without MULTI — partial session
  state is possible (`session.service.ts:24-48`).
- `select d.*` leaks raw dispute rows to the admin API (`disputes.routes.ts:237`);
  `select o.*` in participant order detail (`orders.routes.ts:221`).
- Frontend `hydrate()` treats network/429/5xx as logout (`auth-store.ts:57-68`).

## Remaining plan for this cycle

Work order (per the hardening task): 1 domain invariants → 2 atomic account creation →
3 versioned session revocation → 4 tx retries → 5 resource abuse (uploads/WS/pagination)
→ 6 shared API contracts → 7 order state machine → 8 frontend test foundation →
9 frontend reliability → 10 runtime/ops → 11 CI gates → 12 Playwright E2E →
13 multilingual search.

Do not re-implement: outbox, idempotency, Redis Pub/Sub, message ACK, seller stats,
storage ownership, cache invalidation, 2FA lifecycle, dispute recovery, audit
sanitization, public seller DTO — these are done and covered by the 210-test backend
suite.
