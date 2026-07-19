# Production hardening stage 2 progress

## Stage 0: baseline

Status: complete.

- Commit: `48f9fd0 docs: record production hardening stage 2 baseline`
- Baseline source SHA: `72c7bbb29e39414e6d1d7dffabe971868b5d0088`
- Detailed results: `docs/hardening-stage-2-baseline.md`
- The initial backend test failure was confirmed as an environment issue. After starting
  local PostgreSQL/Redis, creating `marketplace_test`, and applying all 28 migrations,
  the unchanged baseline suite passed 162/162 tests.

## Stage 1: marketplace cache invalidation

Status: complete.

Planned commit: `fix(cache): invalidate marketplace visibility after moderation`

### Confirmed defect

- Public product detail returned `marketplace:product:{id}` before checking current
  product/seller visibility.
- Admin listing moderation did not invalidate any marketplace cache.
- Seller ban/unban did not invalidate product detail, list, seller, or aggregate caches.
- Category/game counters included active products from banned sellers.
- Stock and sales mutations left cached product/list payloads stale.
- Cache invalidation was duplicated across seller and moderation routes.

### Implementation

- Added one marketplace cache service with `ProductCacheContext`.
- Product detail keys are deleted in bounded batches.
- List and seller/game/category/section namespaces are removed in one Redis keyspace pass,
  avoiding one `SCAN` per product during seller ban.
- Seller ban loads every related product context in one SQL query, preserves existing
  session revocation and WebSocket disconnect behavior, and invalidates the batch once.
- Wired seller create/update/pause/activate/delete, admin block/delete/restore/promotional
  flags, media moderation, seller ban/unban, catalog mutations, payment stock decrement,
  and completed-sale counter increment.
- Product moves invalidate both their previous and new category/game/section contexts.
- Public category/game/section/suggestion counts now exclude banned sellers, matching
  public product visibility.
- No financial formula, provider, ledger, payout, or wallet-accounting behavior changed.
- No migration was required.

### Regression coverage

Added five integration scenarios that warm the real Redis cache before mutation and do
not manually clear it between the mutation and assertion:

1. Admin block makes the next anonymous detail request return 404; owner preview remains.
2. Seller ban removes the product from detail/list/counters; unban restores it immediately.
3. Category counts refresh after product create, delete, and block.
4. Rejected media disappears from an already cached product.
5. Stock refreshes after payment and sales count refreshes after escrow release.

The older public-visibility tests no longer manually delete each product cache key during
setup; UUID-isolated keys exercise normal behavior.

### Verification

| Command | Result |
| --- | --- |
| `cd backend && npm run lint` | PASS |
| `cd backend && npm run build` | PASS |
| Targeted Vitest cache/visibility run | PASS, 13/13 |
| `cd backend && npm test` | PASS, 167/167 in 16/16 files |
| `cd frontend && npm run typecheck` | PASS |
| `cd frontend && npm run i18n:check` | PASS, 0 errors and 25 baseline warnings |
| `cd frontend && npm test` | NOT AVAILABLE, package has no `test` script |
| `cd frontend && npm run build` | PASS, with existing Sentry/OpenTelemetry warnings |

### Remaining constraints

- Marketplace invalidation is best-effort when Redis is unavailable, consistent with the
  existing cache layer. Durable side effects belong to the later outbox stage.
- Frontend unit tests remain deferred to the frontend reliability stage.

## Stage 2: secure two-factor lifecycle

Status: complete.

Planned commit: `fix(auth): make two-factor replacement and backup codes atomic`

### Confirmed defects

- Starting setup overwrote the only TOTP secret and immediately invalidated the active
  authenticator before the replacement was confirmed.
- TOTP secrets were stored as plaintext.
- Backup-code consumption used a read/compare/unconditional-update sequence, allowing two
  concurrent requests to accept the same code.
- Disable deleted the method and backup codes and changed the user flag in three separate
  transactions.
- Replacement setup and backup-code regeneration had no recent-authentication contract;
  disable accepted only passwords, leaving Telegram-only accounts without a safe path.

### Implementation

- Added forward-only migration `1783290300000_secure-2fa-lifecycle.sql` with separate active
  and pending encrypted-secret bundles, pending timestamps, all-or-none constraints, and an
  expiry index.
- Added AES-256-GCM authenticated encryption using a required production
  `TWO_FACTOR_ENCRYPTION_KEY`; every row stores ciphertext, IV, authentication tag, and key
  version. AAD binds ciphertext to the user ID and key version.
- Existing plaintext secrets are encrypted in bounded batches and cleared before the API
  starts listening. Per-user migration checks also cover an in-flight legacy record.
- Setup preserves the active method and creates a pending method with a 20-minute TTL.
  Confirmation locks the user/method rows, verifies the pending secret, promotes it, rotates
  backup codes, enables the user flag, and records a security audit in one transaction.
- Backup codes are still bcrypt-hashed and are now consumed with
  `UPDATE ... WHERE used_at IS NULL RETURNING`, so only one concurrent request can succeed.
- Disable locks the user and performs method deletion, backup-code deletion, flag update,
  and explicit security audit in one transaction.
- Replacement, disable, and backup-code regeneration require the current password or a
  confirmed active TOTP. Telegram-only accounts use the TOTP path.
- Added `/users/me/2fa/backup-codes/regenerate`; all 2FA mutation routes use the auth rate
  limiter.
- Updated the settings UI for authenticator replacement, backup-code regeneration, and
  password/TOTP reauthentication in all three locales.
- No financial formula, payment provider, ledger, payout, wallet, or accounting behavior
  changed.

### Regression coverage

Added seven integration scenarios:

1. Active TOTP remains valid during replacement; pending TOTP cannot log in until confirmed.
2. Pending setup expires after 20 minutes without disturbing the active method.
3. Two concurrent uses of one backup code produce exactly one success.
4. Backup-code regeneration requires reauthentication and invalidates the old set.
5. A Telegram-only account disables 2FA through the real HTTP route using active TOTP.
6. Injected security-audit failure rolls the complete disable transaction back.
7. A confirmed legacy plaintext secret is encrypted, cleared, and remains usable.

The schema contract now asserts encrypted method columns and no legacy plaintext.

### Verification

| Command | Result |
| --- | --- |
| `cd backend && npm run lint` | PASS |
| `cd backend && npm run build` | PASS |
| Targeted lifecycle/schema Vitest run | PASS, 13/13 |
| `cd backend && npm test` | PASS, 174/174 in 17/17 files |
| Clean database migration smoke | PASS, all 29 migrations |
| Lifecycle/schema tests on clean database | PASS, 13/13 |
| `cd frontend && npm run typecheck` | PASS |
| `cd frontend && npm run i18n:check` | PASS, 0 errors and 25 baseline warnings |
| `cd frontend && npm test` | NOT AVAILABLE, package has no `test` script |
| `cd frontend && npm run build` | PASS, with existing Sentry/OpenTelemetry warnings |
| `docker compose config --quiet` with required secrets | PASS |

### Deployment constraints

- Set and durably back up a unique 32-byte production key before applying the migration or
  starting the new application. The key must remain stable for version 1 ciphertext.
- The current runtime intentionally fails closed on an unknown key version. A future key
  rotation must deploy a keyring/re-encryption migration before incrementing the version.

## Stage 3: immutable dispute evidence and recoverable resolution

Status: complete.

Planned commit: `fix(disputes): make evidence immutable and resolution recoverable`

### Confirmed defects

- Reopening an existing dispute overwrote its original reason and updated timestamp.
- Resolution persisted neither the requested decision nor a stable operation identity
  before calling escrow.
- A failed escrow call reset the dispute to an unclaimed state, allowing a later retry to
  choose the opposite decision.
- A process crash could leave `resolving` indefinitely; recovery depended on a caller
  repeating the original request correctly.
- Dispute evidence had no append-only participant/admin message channel.

### Implementation

- Added forward-only migration `1783290400000_harden-dispute-lifecycle.sql`.
- Database triggers make the original `opened_by`, `reason`, and `created_at` immutable.
  Repeated opens return the existing dispute without rewriting evidence; a different
  participant or reason is directed to the message channel.
- Added append-only `dispute_messages` with participant/admin authorization, optional
  attachment URLs, indexes, validation, immutable content, and idempotent admin hiding.
- Added durable `resolution_decision`, `resolution_operation_id`,
  `resolving_started_at`, `resolution_attempts`, and `last_resolution_error` fields with
  state constraints and a unique operation index.
- Resolution now claims the decision and operation in a transaction before escrow,
  preserves the original admin/note on every retry, rejects opposite decisions with 409,
  and records retryable failures without discarding claim identity.
- Matching terminal order state is reconciled into `resolved` without calling escrow
  again. A queue worker reclaims claims older than 15 minutes using only persisted
  decision, operation, and administrator data.
- Existing escrow, ledger, provider, payout, wallet, fee, and accounting code was not
  changed.

### Regression coverage

Added five integration scenarios:

1. Buyer evidence remains byte-for-byte unchanged after a seller repeats the open with a
   different reason; the seller can append a message, outsiders are denied, and admin
   moderation does not mutate message content.
2. An escrow failure stores `resolution_failed`, the original decision and operation ID,
   then retries the same operation; an opposite decision is rejected.
3. A stale crash-before-escrow claim is recovered by the worker with the persisted
   decision and operation ID.
4. A crash-after-escrow state is finalized without a second escrow call; subsequent
   same-decision retries are idempotent and an opposite decision is rejected.
5. Two concurrent admins produce one escrow call, one success, and one 409 conflict.

The tests also exercise database-level rejection of original-evidence updates, dispute
message content updates, and dispute message deletion.

### Verification

| Command | Result |
| --- | --- |
| `cd backend && npm run lint` | PASS |
| `cd backend && npm run build` | PASS |
| Targeted dispute Vitest run | PASS, 5/5 |
| `cd backend && npm test` | PASS, 174/174 in 17/17 files |
| Clean database migration smoke | PASS, all 30 migrations |
| Dispute/schema tests on clean database | PASS, 11/11 |
| `cd frontend && npm run typecheck` | PASS |
| `cd frontend && npm run i18n:check` | PASS, 0 errors and 25 baseline warnings |
| `cd frontend && npm test` | NOT AVAILABLE, package has no `test` script |
| `cd frontend && npm run build` | PASS, with existing Sentry/OpenTelemetry warnings |

### Remaining constraints

- Resolution notifications and order-event/chat side effects still run after the durable
  financial state transition and are not replayed by the recovery worker. Making those
  side effects durable is intentionally deferred to the outbox stage.
- The stale-claim timeout is currently a fixed 15 minutes.
