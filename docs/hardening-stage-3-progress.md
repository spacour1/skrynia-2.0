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
