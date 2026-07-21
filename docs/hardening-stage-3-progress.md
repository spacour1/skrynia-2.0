# Production hardening cycle 3 progress

Branch: `hardening/cycle-3`. Baseline: `docs/current-hardening-baseline.md`
(main @ `48f994d`). Stage order and scope follow the cycle-3 hardening task.

## Stage 0: baseline

Status: complete.

- Commit: `docs(hardening): refresh baseline and remaining plan`
- All baseline checks ran for real: backend lint/build/test (218/218), frontend
  typecheck/i18n/test (6/6)/build, compose config, compose image builds — PASS.
- Full capability table and confirmed-defect inventory live in the baseline document.

## Stage 1: domain invariants

Status: complete.

Commit: `fix(domain): reconcile marketplace lifecycle invariants`

### Confirmed drift

1. Docs described a `created` order status; the schema has used `pending` since the
   initial migration (plus `canceled` since `1782658636398`, used by the mock payment
   failure flow).
2. Docs documented the platform fee as `ceil`; the code (and the booked ledger
   history) uses floor.
3. Docs granted dispute resolution to moderators; every resolution endpoint requires
   `admin`.
4. Docs referenced a nonexistent `wallets.balance_cents`; the schema has
   `available_cents` + `escrow_cents`.
5. Catalog sections accepted `service` as an allowed delivery type
   (`game_sections_allowed_delivery_types_check` and the section service), while
   `products.delivery_type` has always rejected it — a section configured that way
   produced lots failing with a DB 500 instead of a 400. The admin UI offered the
   same phantom option.
6. The actual dispute lifecycle has four states (`open, resolving, resolved,
   resolution_failed`) — the recovery states from migration `1783290400000` are load
   bearing and are now part of the canonical enum.
7. Lifecycle values (roles, statuses, kinds, types) were string literals duplicated
   across Zod schemas, services, and the frontend with no single source of truth.

### Implementation

- Added `backend/src/domain/enums.ts` — canonical const arrays + types + guards for
  OrderStatus, ProductStatus, DisputeStatus, DisputeDecision, DeliveryType,
  ProductType, CatalogStatus, CatalogSchemaStatus, Role, MessageKind.
- Added `backend/src/domain/money.ts` — `platformFeeCents` (floor, BigInt-exact,
  input-validated); `ledger.service.ts` now delegates to it. No rounding-direction
  change: floor was already the booked rule.
- Zod schemas and services now derive from the canonical arrays: marketplace product
  create (deliveryType/productType), dispute resolve decision, catalog section
  validation, catalog status helpers, `common/types.ts` Role.
- Migration `1783291000000_reconcile-delivery-types.sql`: strips `service` from
  `game_sections.allowed_delivery_types`, restores the default pair for sections left
  empty, re-creates the CHECK as `<@ {instant,manual}` plus non-empty. Local dev/test
  data contained zero affected rows; the backfill still handles them.
- Section service now rejects empty `allowedDeliveryTypes`; admin `SectionForm` no
  longer offers `service` as a delivery type.
- New `docs/domain-invariants.md` — canonical sets, order transition graph as
  currently implemented, fee rule, money/ledger invariants, dispute permission
  matrix. `product-behavior.md`, `AGENTS.md`, `testing.md` reconciled to it.

### Regression coverage (`backend/test/domain-invariants.test.ts`, 22 tests)

1. Every lifecycle CHECK constraint's literal set equals the canonical enum
   (orders, products ×3, disputes ×2, users.role, messages.kind, catalog ×4).
2. Every canonical order status round-trips through the DB; `created` is rejected by
   `orders_status_check`.
3. `service` and empty delivery-type lists are rejected at both the DB constraint and
   the catalog service; manual/instant sections still work.
4. Fee: floor behavior on odd amounts, BigInt exactness at `MAX_SAFE_INTEGER` cents,
   invalid input rejection.
5. Docs scan: no `created` order status, fee documented as floor, wallet docs
   reference real columns.

### Verification

| Command | Result |
| --- | --- |
| `cd backend && npm run lint` | PASS |
| `npx vitest run test/domain-invariants.test.ts` | PASS, 22/22 |
| `cd backend && npm test` | PASS, 240/240 in 24 files |
| Clean-database migration smoke (marketplace_smoke, all 36) | PASS |
| `cd frontend && npm run typecheck` | PASS |

## Stage 2: atomic account creation

Status: complete.

Commit: `fix(auth): make account creation atomic`

### Confirmed defect

Email and Telegram registration ran the user insert, the mandatory wallet insert, and
session issuance as independent operations on the pool. A failure after the user
insert left a committed account without a wallet, and the caller received an error for
an account that in fact existed. (Duplicate email was already mapped 23505 → 409 by
the global error handler — that part needed no change.)

### Implementation

- Both registration paths now create the user and its wallet in one `inTx`
  transaction; the row is returned from the transaction and the session is issued only
  after commit.
- The verification email and other side effects stay outside the transaction
  (fire-and-forget), so notification failures cannot roll back a committed account and
  no external call runs inside a DB transaction.
- No pre-SELECT for duplicates: the unique constraint plus the existing 23505 → 409
  mapping remains the concurrency-safe contract.

### Regression coverage (`backend/test/registration-atomicity.test.ts`, 7 tests)

1. Registration creates user + wallet together and sets session cookies.
2. An injected wallet-insert failure (DB trigger) rolls back the user and issues no
   session cookie.
3. Duplicate email → 409, one account, no session.
4. Unsendable verification email does not affect the committed account.
5. Telegram: new account creates user + wallet atomically.
6. Telegram: injected wallet failure rolls back the new user.
7. Repeated Telegram login reuses the account (no duplicates).

### Verification

| Command | Result |
| --- | --- |
| `cd backend && npm run lint` | PASS |
| `npx vitest run test/registration-atomicity.test.ts` | PASS, 7/7 |
| `npx vitest run test/auth.test.ts test/email-verification.test.ts` | PASS, 24/24 |

## Stage 3: versioned session revocation

Status: complete.

Commit: `fix(auth): enforce versioned session revocation`

### Confirmed defect

Session revocation lived only in Redis (`session:{jti}`, `refresh:{hash}` plus
per-user sets). Password change/reset, 2FA changes, and bans reported success even if
the Redis deletion failed (`revokeAllUserSessions` logs and continues), leaving old
access and refresh sessions fully usable. `issueSession` also ran six independent
Redis commands, so a mid-issue failure could leave partial session state.

### Implementation

- Migration `1783291100000_add-session-version.sql`: `users.session_version integer
  not null default 1`.
- `issueSession` reads the user's current version, embeds `sv` in the access JWT,
  stores the refresh record as JSON `{"u":userId,"v":version}`, and executes all six
  Redis commands in one MULTI (failure → 503, no partial session).
- `authenticate`/`authenticateOptional` compare the token's `sv` (missing claim = 1,
  the migration default, so pre-rollout sessions stay valid until the first bump)
  against `users.session_version` in the SELECT they already make per request.
- `/auth/refresh` parses the record (legacy plain-string = version 1) and rejects a
  version mismatch with 401 + cookie clear.
- `bumpSessionVersion(client, userId)` runs in the same transaction/statement as each
  security-state change: password change (single UPDATE), password reset (single
  UPDATE), logout-all, 2FA enable/replace confirm, 2FA disable, backup-code
  regeneration (which always rotated all sessions), admin ban and role change.
- Redis revocation and the realtime session-revoked events remain the immediate kill
  switch (WS close, refresh delete); the DB epoch is the guarantee.

### Regression coverage (`backend/test/session-versioning.test.ts`, 7 tests)

Each "revocation lost" scenario re-creates the old session's Redis keys after the
security change, simulating a Redis failure, and the session must still die:

1. Password change: other session rejected (access + refresh), caller rotated.
2. Password reset: all sessions dead, old password rejected, new password works.
3. Logout-all: restored Redis state cannot revive a session; fresh login works.
4. Admin ban: banned user's session rejected durably.
5. 2FA enable and disable bump the version.
6. Legacy access token without `sv` is valid until the first bump, then dead.
7. Legacy plain-string refresh record works as version 1 and dies after a bump.

### Verification

| Command | Result |
| --- | --- |
| `cd backend && npm run lint` | PASS |
| Migration on test DB | PASS (37 total) |
| `npx vitest run test/session-versioning.test.ts` | PASS, 7/7 |
| `cd backend && npm test` | PASS, 254/254 in 26 files |

## Stage 4: transaction retries

Status: complete.

Commit: `fix(db): retry serialization failures and deadlocks`

### Confirmed defect

`inSerializableTx` propagated PostgreSQL `40001` (serialization_failure) and `40P01`
(deadlock_detected) directly to the HTTP error handler, returning 500 for outcomes
PostgreSQL documents as "retry the transaction". Escrow release, refunds, and wallet
operations run under SERIALIZABLE and could randomly fail under concurrency.

### Implementation

- `inSerializableTx(fn, options?)` now retries only `40001`/`40P01`: 3 attempts by
  default, exponential cap with full jitter (20ms base, 200ms max), rollback always
  happens before the retry (each attempt is a fresh transaction), structured warn
  logs, and `marketplace_transaction_retry_total` /
  `marketplace_transaction_retry_exhausted_total{code}` counters.
- Side-effect audit of every SERIALIZABLE caller: wallet topup/withdraw/adjust/reject
  and escrow release/refund contain only DB writes plus idempotent cache deletes —
  safe to retry. `lockEscrow` calls `provider.capture()` inside the transaction, so it
  explicitly passes `{ maxAttempts: 1 }` (no retry; the provider path keeps its own
  idempotency key). No payment-provider behavior changed.

### Regression coverage (`backend/test/tx-retry.test.ts`, 7 tests)

40001 retried then succeeds; 40P01 retried; arbitrary error not retried; exhaustion
after maxAttempts rethrows; successful callback runs once; the failed attempt's
insert is rolled back before the retry (verified through a unique-constraint probe);
`maxAttempts: 1` opts out.

### Verification

| Command | Result |
| --- | --- |
| `cd backend && npm run lint` | PASS |
| `npx vitest run test/tx-retry.test.ts` | PASS, 7/7 |
| `npx vitest run test/ledger.test.ts test/test-payments.test.ts` | PASS, 16/16 |
| `cd backend && npm test` | PASS, 261/261 in 27 files |

## Stage 5.1: upload quotas and processing bounds

Status: complete.

Commit: `fix(storage): enforce quotas and durable deletion`

### Confirmed defect

Uploads had a per-file cap (8 MB multer limit) and image validation, but nothing
stopped one authenticated user from uploading thousands of files: no upload rate
limiter, no per-user daily byte budget, no total storage quota, no per-purpose object
ceiling, and unbounded parallel Sharp processing (each task holds the full decoded
image in memory). Durable deletion and temporary-TTL cleanup were NOT missing — the
outbox `storage.delete` event (committed with the business change) plus the
`storage_cleanup` job already implement the durable-intent flow, so that part of the
plan required no change.

### Implementation

- New env-config ceilings (all with production compose passthrough and example-env
  entries): `STORAGE_DAILY_UPLOAD_BYTES_PER_USER` (100 MB),
  `STORAGE_TOTAL_QUOTA_BYTES_PER_USER` (500 MB), `STORAGE_MAX_OBJECTS_PER_PURPOSE`
  (500), `STORAGE_MAX_CONCURRENT_PROCESSING` (4), `STORAGE_PROCESSING_QUEUE_LIMIT`
  (16), `UPLOAD_RATE_LIMIT_PER_MIN` (20/user), `UPLOAD_RATE_LIMIT_PER_IP` (60).
- Dedicated `uploadRateLimit` (user bucket + IP ceiling) on `/storage/upload`,
  registered in the dedicated-write-paths set so upload floods cannot drain general
  write budgets. 429s carry `Retry-After` like every other limiter.
- Quota rules: live bytes (temporary + attached) count toward the total quota; the
  daily window counts everything created in 24h (deleting does not refund the day's
  processing budget); per-purpose counts live objects. Temporary objects count
  everywhere, so attach needs no byte re-check.
- Cheap pre-check with the raw upload size runs before any Sharp work; the definitive
  re-check plus insert run under a per-owner `pg_advisory_xact_lock`, so parallel
  uploads serialize and cannot jointly overshoot.
- `ProcessingSemaphore` bounds concurrent Sharp work with a short queue; past the
  queue the request gets 503 instead of buffering unbounded memory. Metrics:
  `storage_quota_rejected_total{reason}`, `storage_processing_active`.

### Regression coverage (storage-quotas 7 + upload-rate-limit 1)

Daily quota rejection; deleted objects still consume the daily window; total-quota
rejection; deletion frees the total quota; per-purpose ceiling (other purpose
unaffected); 4 parallel uploads at ceiling-1 produce exactly 1 success and the DB
count equals the ceiling; semaphore bounds concurrency and 503s past the queue;
per-user 429 with integer Retry-After leaves another user unaffected and creates no
row.

### Verification

| Command | Result |
| --- | --- |
| `cd backend && npm run lint` | PASS |
| `npx vitest run test/storage-quotas.test.ts test/upload-rate-limit.test.ts` | PASS, 8/8 |
| `npx vitest run test/storage.test.ts test/product-media-transaction.test.ts` | PASS, 10/10 |
| `cd backend && npm test` | PASS, 269/269 in 29 files |
