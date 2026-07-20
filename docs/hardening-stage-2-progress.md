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

## Stage 4: separated rate limiting

Status: complete.

Planned commit: `fix(security): separate authenticated and credential rate limits`

### Confirmed defects

- Global API and write limiters ran before authentication, so `req.user` was never
  available and every protected caller behind one address shared an IP-only bucket.
- Login, registration, 2FA, authenticated security actions, and WebSocket ticket minting
  shared the same auth limiter.
- Authenticated writes had no independent user ceiling plus aggregate IP ceiling.
- The 429 response did not explicitly guarantee `Retry-After`, and the frontend discarded
  that response metadata.

### Implementation

- Added a pre-limiter identity middleware that verifies only the signed access-token
  envelope and exposes user/session IDs. It never authorizes, checks revocation, queries
  users, or turns an invalid token into an auth result; route `authenticate` remains the
  security decision.
- Replaced the pre-auth aggregate API limiter with distinct `publicReadRateLimit`,
  `anonymousWriteRateLimit`, and `authenticatedWriteRateLimit` middleware. Authenticated
  writes consume both a user bucket and an independent IP ceiling.
- Added separate credential, WebSocket ticket, phone OTP, email verification, password
  reset, and webhook limiters. Sensitive routes are excluded from general write buckets,
  so their traffic cannot exhaust unrelated flows.
- Credential keys use IP plus HMAC-SHA-256 email, Telegram identity, or 2FA-token identity
  when available. Phone OTP uses user ID, HMAC-SHA-256 phone, and IP. Email and phone
  values never appear in Redis keys as plaintext.
- WebSocket tickets use a session bucket with user fallback plus an IP ceiling. Added
  independent `WS_TICKET_RATE_LIMIT_PER_MIN` and `WS_TICKET_RATE_LIMIT_PER_IP`
  configuration suitable for reconnect traffic.
- Added configurable ceilings for every limiter family and wired them through production
  Compose. Legacy aggregate environment settings remain as fallbacks during deployment
  migration.
- Every 429 now carries an integer `Retry-After` header and matching JSON value. Frontend
  `ApiError.retryAfterSeconds` parses either delta-seconds or an HTTP date without
  automatically replaying mutating requests.
- No migration or financial, provider, ledger, payout, wallet, fee, or accounting change
  was required.

### Regression coverage

Added six real HTTP scenarios with production-style Redis stores and deliberately low
ceilings:

1. Two authenticated users behind one IP have independent user buckets; the limited user
   receives 429 while the other continues.
2. One user cannot bypass the user ceiling by changing source IP.
3. Multiple users still share the independent authenticated IP ceiling.
4. Exhausting WS ticket issuance does not block login.
5. Exhausting login attempts does not block WS reconnect ticket issuance.
6. Credential identity is enforced across IPs, and Redis keys do not contain plaintext
   email.

The 429 scenario asserts a positive integer `Retry-After` header equal to the JSON value.
The dedicated test overrides the suite-wide high ceilings before importing the app and
clears only `rl:*` keys between cases.

### Verification

| Command | Result |
| --- | --- |
| `cd backend && npm run lint` | PASS |
| `cd backend && npm run build` | PASS |
| Targeted low-ceiling rate-limit run | PASS, 6/6 |
| Neighboring auth/2FA/email/WS/validation run | PASS, 50/50 |
| `cd backend && npm test` | PASS, 180/180 in 18/18 files |
| Clean database migration smoke | PASS, all 30 migrations |
| Rate-limit/schema tests on clean database | PASS, 12/12 |
| `cd frontend && npm run typecheck` | PASS |
| `cd frontend && npm run i18n:check` | PASS, 0 errors and 25 baseline warnings |
| `cd frontend && npm test` | NOT AVAILABLE, package has no `test` script |
| `cd frontend && npm run build` | PASS, with existing Sentry/OpenTelemetry warnings |
| `docker compose config --quiet` with required secrets | PASS |

### Deployment constraints

- Configure `REDIS_URL` on every API replica so buckets are shared. Without Redis, the
  documented fallback is an in-memory bucket per process.
- Set `TRUST_PROXY` to the exact trusted proxy-hop count; incorrect proxy trust makes IP
  ceilings either shared too broadly or derived from an untrusted forwarding header.
- New sensitive write endpoints must be assigned to a dedicated limiter or removed from
  the general-write exclusion registry in the same change.

## Stage 5: realtime reconnects, acknowledgements, and session revocation

Status: complete.

Planned commit: `fix(realtime): add typed reconnects message acknowledgements and revocation`

### Confirmed defects

- The ticket helper silently swallowed every ticket-endpoint error and attempted a cookie
  handshake even when a cross-domain production deployment could not send that cookie.
- `ChatPanel` and `ToastCenter` each owned a socket and reconnect loop, creating duplicate
  connections and inconsistent retry behavior.
- WebSocket sends cleared the form before the server confirmed that a message was saved.
- Password, role, ban, logout, and other security changes did not share a process-local
  socket-revocation contract.
- Outbound WebSocket buffers and per-connection conversation rooms were unbounded.

### Implementation

- Added `WebSocketTicketError` with status, code, retryability, and optional Retry-After
  milliseconds. Authentication and other 4xx failures stop reconnecting, 429 uses the
  server delay, and transient failures use capped exponential backoff.
- Restricted cookie fallback to development, a same-origin WebSocket deployment, or the
  explicit `NEXT_PUBLIC_WS_COOKIE_FALLBACK=true` build setting.
- Added one `RealtimeClient` and `RealtimeProvider` per tab. It owns ticket acquisition,
  reconnect state, visibility/network handling, auth refresh, room reference counts,
  event subscribers, pending messages, and logout cleanup.
- Migrated chat and toast consumers to the provider. Chat-room broadcasts no longer
  duplicate the canonical recipient notification toast.
- Added UUID `clientMessageId` sends and `message_ack`/`message_error` responses. The chat
  keeps optimistic rows in `sending`, changes them to `sent` only after an ACK or HTTP
  response, and exposes `failed` plus retry when delivery is uncertain.
- Added process-local `session.revoked`, `user.sessions.revoked`, and `user.banned` events.
  Password reset/change, logout/logout-all, 2FA security changes, bans, and role changes
  close affected sockets. Authenticated security changes rotate the caller to a new
  session after old sockets close.
- Added an exposed `X-Session-Rotated` response signal and cross-tab frontend refresh
  notification so the newly issued session reconnects without a page reload.
- Added `WS_MAX_BUFFERED_BYTES`, a slow-client close path and metric, plus
  `WS_MAX_ROOMS_PER_CONNECTION` with explicit join/leave handling.
- No schema migration or financial, provider, ledger, payout, wallet, fee, or accounting
  change was required.

### Regression coverage

Frontend unit coverage verifies:

1. A 401 ticket error stops reconnecting.
2. A 429 uses the exact Retry-After delay.
3. Repeated 503 failures wait 1 second, then 2 seconds.
4. Repeated starts and multiple subscribers still create one connection.
5. ACK changes delivery from `sending` to `sent`.
6. Disconnect before ACK changes delivery to `failed` and retryable.

Backend integration coverage verifies:

1. The ACK echoes `clientMessageId` and contains the row durably saved in PostgreSQL.
2. The configured room ceiling rejects the next join and a leave frees one slot.
3. Password change closes the old socket while the newly issued session still connects.
4. A client above the outbound-buffer limit closes without another send or process error.
5. Logout-all invalidates access and refresh state on every device.

### Verification

| Command | Result |
| --- | --- |
| `cd backend && npm run lint` | PASS |
| `cd backend && npm run build` | PASS |
| Targeted WebSocket run | PASS, 12/12 |
| `cd backend && npm test` | PASS, 185/185 in 18/18 files |
| Clean database migration smoke | PASS, all 30 migrations |
| Schema/WebSocket tests on clean database | PASS, 18/18 |
| `cd frontend && npm run typecheck` | PASS |
| `cd frontend && npm test` | PASS, 6/6 |
| `cd frontend && npm run i18n:check` | PASS, 0 errors and 25 baseline warnings |
| `cd frontend && npm run build` | PASS, with existing Sentry/OpenTelemetry warnings |
| `docker compose config --quiet` with required secrets | PASS |

### Remaining constraints

- Revocation events are process-local in this stage. Multi-replica deployments still need
  sticky sessions until Stage 11 distributes these events with Redis Pub/Sub.
- `clientMessageId` correlates an ACK but is not yet a persistent deduplication key. Stage
  10 adds the column and unique partial index so retry after a lost ACK cannot duplicate a
  saved message.
- Reverse proxies must preserve `X-Session-Rotated`, and production deployments should
  leave cross-origin cookie fallback disabled unless the cookie domain is intentionally
  configured for that WebSocket origin.

## Stage 6: product section/schema consistency

Status: complete.

Planned commit: `fix(catalog): preserve product section schema consistency`

### Confirmed defects

- `PATCH /marketplace/products/:id` allowed `sectionId` to change while leaving metadata
  and `schema_version` pinned to the previous section.
- Explicit `metadata: null` skipped schema validation and could clear required fields
  without updating the schema version.
- Product activation checked the active catalog chain and delivery type, but did not
  reject a stale schema pair or revalidate the stored metadata against the current schema.
- Product creation and update resolved catalog state outside the write transaction,
  leaving a race with schema publication or catalog status changes.
- PostgreSQL did not require a sectioned product to reference an existing schema version
  from that section.

### Implementation

- A real section change now requires `metadata` in the same request and returns
  `400 validation_error` before any product field is changed when it is absent.
- Product creation and update now resolve the active group/item/section chain, validate
  delivery and metadata, and write the product in one transaction. Section, item, and
  group rows are share-locked while the contract is selected.
- `PATCH` locks the product row with `FOR UPDATE`, validates `metadata: null` as an empty
  object, and writes `section_id`, `schema_version`, and filtered metadata together.
- Reactivation repeats catalog, active-schema, required-field, metadata, and delivery
  validation. A stale schema pair cannot be activated without resubmitting current
  metadata; a valid resubmission advances the product to the active schema version.
- Existing section-owned category, game, and product type values are no longer
  overwritten by unrelated client fields. Reactivation re-derives them from the section.
- Added migration `1783290500000_enforce-product-section-schema-consistency.sql`. It
  backfills legacy null versions from an existing current section schema, clears versions
  on sectionless products, enforces pair nullability, and adds the composite foreign key:
  `(section_id, schema_version) -> catalog_section_schemas(section_id, version)`.
- No frontend or financial, provider, ledger, payout, wallet, fee, or accounting change
  was required.

### Regression coverage

1. Changing section A to B without metadata returns 400 and preserves the old section,
   schema version, metadata, title, and media.
2. Changing to section B with valid metadata updates all three contract fields together
   and drops metadata keys not declared by B.
3. Invalid new-section metadata leaves every product field and media row unchanged.
4. A paused product pinned to schema v1 cannot reactivate after v2 publication without
   current metadata; valid v2 metadata updates the pair and activates it.
5. PostgreSQL rejects both a section without a schema version and a non-existent
   section/version pair.

### Verification

| Command | Result |
| --- | --- |
| `cd backend && npm run lint` | PASS |
| `cd backend && npm run build` | PASS |
| Targeted catalog/schema-contract run | PASS, 57/57 |
| `cd backend && npm test` | PASS, 190/190 in 18/18 files |
| Clean database migration smoke | PASS, all 31 migrations |
| New constraints on clean database | PASS, both validated |
| Catalog/schema-contract tests on clean database | PASS, 57/57 |

### Remaining constraints

- PostgreSQL guarantees that the structural section/version pair exists, while JSON
  metadata conformance remains an application-level validation because it depends on the
  versioned dynamic schema document.
- Active products intentionally remain pinned to their historical schema when a new
  version is published. The current schema is required again when metadata changes or a
  paused product is reactivated.
- A deployment containing an irreparable pre-existing mismatched non-null pair will stop
  during constraint validation instead of silently assigning metadata to another schema.

## Stage 7: safe audit URLs

Status: complete.

Planned commit: `fix(security): remove query secrets from audit paths`

### Confirmed defects

- The generic audit middleware persisted `req.originalUrl` in `audit_logs.path`, so query
  values such as tokens, codes, secrets, or WebSocket tickets could be stored verbatim.
- The structured HTTP logger emitted the same full URL.
- The 2FA domain-audit context also copied `originalUrl` into security audit rows.
- Sentry's HTTP integration could attach full request URLs, query strings, request data,
  cookies, and URL-bearing breadcrumbs independently of the application audit row.
- The recursive redactor returned objects unchanged after its depth limit and did not
  classify compound ticket/code keys such as `wsTicket` or `verificationCode`.

### Implementation

- Added centralized safe request helpers. Audit `path` is now the full pathname assembled
  from `baseUrl + req.path`, while `endpoint` is the normalized parameterized route.
  Mounted-route prefixes are reconstructed after Express unwinds an errored router.
- The generic audit row and structured HTTP log now contain only safe path/endpoint plus a
  recursively redacted query object. Request bodies remain excluded.
- Token, secret, password, ticket, code, OTP, IBAN, and card key families are redacted
  case-insensitively at every nesting level. Objects beyond the depth ceiling are
  truncated instead of being returned unsanitized.
- Updated the 2FA security-audit context and rate-limit route matching to use safe pathname
  helpers. Runtime source no longer references `originalUrl`.
- Added Sentry `beforeBreadcrumb`, `beforeSend`, and `beforeSendTransaction` sanitizers.
  They strip query strings from request, transaction, and nested breadcrumb URL fields,
  remove request body/cookies/query data, and redact sensitive headers.
- The WebSocket handshake reads `req.url` only to consume the one-time ticket and never
  logs or persists that URL.
- Added an injectable request logger solely at application construction boundaries, which
  allows tests to verify the serialized Pino output without replacing the production
  logger.
- Added forward-only migration
  `1783290600000_remove-query-secrets-from-audit-paths.sql`, which removes query strings
  from historical `audit_logs.path` and `audit_logs.endpoint` values.
- No frontend or financial, provider, ledger, payout, wallet, fee, or accounting change
  was required.

### Regression coverage

1. `POST /test?token=<secret>&safe=value` stores `/test` as both path and endpoint.
2. The secret is absent from the complete PostgreSQL audit row.
3. The captured structured log contains the safe query value and redacts the token.
4. Recursive redaction covers compound ticket/code keys.
5. Sentry request URLs, transactions, headers, request payloads, cookies, and WebSocket
   ticket breadcrumbs are sanitized without retaining the secret.
6. A real Stage-6-to-Stage-7 upgrade seeded with legacy query secrets rewrites both
   historical columns to `/test`.

### Verification

| Command | Result |
| --- | --- |
| `cd backend && npm run lint` | PASS |
| `cd backend && npm run build` | PASS |
| Targeted audit-redaction run | PASS, 6/6 |
| `cd backend && npm test` | PASS, 192/192 in 18/18 files |
| Legacy upgrade migration smoke | PASS, path and endpoint scrubbed |
| Clean database migration smoke | PASS, all 32 migrations |
| Audit-redaction tests on clean database | PASS, 6/6 |
| Main and clean database query-path scan | PASS, 0 rows containing `?` |
| Runtime `originalUrl` source scan | PASS, 0 references |

### Deployment constraints

- Reverse-proxy and hosting-platform access logs are outside this repository. Production
  ingress must log a pathname or a query-stripped request URI; otherwise it can still
  capture ticket/token query values before the request reaches the application.
- Arbitrary application code must not interpolate full URLs into exception messages.
  The Sentry sanitizer covers structured request and breadcrumb URL fields, not opaque
  free-form strings that happen to contain a URL.

## Stage 8: public seller DTO and statistics

Status: complete.

Planned commit: `fix(users): expose safe public profiles and correct seller statistics`

### Confirmed defects

- `GET /users/:id` returned the user's role and complete `settings` object to anonymous
  callers. That object can contain notification preferences and other private account
  configuration.
- Seller products, favorites, and orders were joined before aggregation. Multiple rows
  from each relation multiplied `sales_count` and completed revenue.
- A seller without terminal orders received a fabricated `100%` success rate.
- Category counters included active out-of-stock products even though the public product
  list excluded them.
- The seller page depended on private `settings` from the public response.

### Implementation

- Added an explicit `PublicSellerDto` with exactly `id`, `displayName`, `avatarUrl`,
  `createdAt`, `ratingAverage`, `reviewCount`, and `online`. The public query selects only
  those account columns and maps them field by field.
- Seller totals are computed in independent `product_stats`, `favorite_stats`,
  `order_stats`, and `review_stats` CTEs. Products, favorites, orders, and reviews can no
  longer multiply one another.
- The statistics response now includes active listings, total sales, product favorites,
  active/completed/disputed/refunded orders, completed revenue, success rate, and the
  `hasEnoughData` signal.
- Success rate uses completed outcomes divided by completed, disputed, and refunded
  outcomes. It is `null` until at least three terminal orders exist.
- Category `activeProductCount` now requires an active product, positive stock, and a
  non-banned seller, matching public list visibility.
- The seller page fetches private settings separately through authenticated `/users/me`
  only for its owner. The cache key includes the authenticated user ID, and profile or
  banner updates refresh both owner and public profile caches.
- Added localized "not enough data" output instead of rendering a false percentage.
- No migration or financial, provider, ledger, payout, wallet, fee, or accounting change
  was required.

### Regression coverage

1. The public seller object has exactly the seven DTO fields and contains no settings,
   email, phone, role, notification preference, or private marker.
2. Two products, three favorites, seven mixed-status orders, and two reviews produce exact
   totals without join multiplication.
3. A new seller returns `successRate: null` and `hasEnoughData: false`.
4. Category count and public list both exclude paused, out-of-stock, and banned-seller
   products.

### Verification

| Command | Result |
| --- | --- |
| `cd backend && npm run lint` | PASS |
| `cd backend && npm run build` | PASS |
| Targeted seller/cache run | PASS, 9/9 |
| `cd backend && npm test` | PASS, 196/196 in 19/19 files |
| Clean database migration smoke | PASS, all 32 migrations |
| Public seller tests on clean database | PASS, 4/4 |
| `cd frontend && npm run typecheck` | PASS |
| `cd frontend && npm test` | PASS, 6/6 |
| `cd frontend && npm run i18n:check` | PASS, 0 errors and 25 baseline warnings |
| `cd frontend && npm run build` | PASS, with existing Sentry/OpenTelemetry warnings |

### Remaining constraints

- Seller tagline and banner are still stored inside the mixed private `settings` object.
  Visitors now receive safe defaults. Public customization needs dedicated public columns
  and an explicit DTO before those values can be exposed again.
- The minimum sample size is intentionally fixed at three terminal orders.
- `favoriteCount` counts product-favorite relationships across the seller's non-deleted
  products, not unique users and not seller-profile favorites.

## Stage 9: transactional domain outbox

Status: complete.

Planned commit: `feat(reliability): add transactional domain outbox`

### Confirmed defects

- Order, review, dispute, chat, listing-moderation, and user-moderation routes committed
  business state before starting notifications, WebSocket broadcasts, queue jobs, cache
  invalidation, or session revocation. A process crash or dependency outage in that gap
  could permanently lose the side effect.
- Several request handlers awaited Redis or BullMQ after a successful PostgreSQL commit,
  so a temporary infrastructure failure could turn committed work into an HTTP error.
- Retrying a notification had no durable event identity shared by PostgreSQL and BullMQ,
  allowing duplicate notification rows or delivery jobs.
- A single in-process retry path could not safely distribute work across worker replicas
  or recover a row claimed by a worker that crashed.

### Implementation

- Added `domain_outbox` with a unique event key, aggregate identity, JSON payload,
  pending/processing/processed/failed states, attempt count, availability and lock
  timestamps, processing owner, last error, and lifecycle timestamps. Database checks
  enforce complete lock and processed-state bundles.
- Added indexes for ready-event scans, aggregate lookup, and creation time. Notifications
  now have a nullable, partially unique `event_key` for durable delivery deduplication.
- Added `enqueueDomainEvent(client, event)`. It accepts only a transaction client and is
  called inside the transaction that changes the corresponding aggregate.
- Added a polling worker that claims batches with `FOR UPDATE SKIP LOCKED`, processes them
  with bounded parallelism, refreshes active locks, recovers stale claims, records the
  final error, and applies exponential backoff up to a configurable maximum attempt count.
- Failed events can be explicitly returned to the pending state through the admin retry
  endpoint. Admin job diagnostics include outbox status totals.
- Added typed and payload-validated handlers for order creation/start/delivery/completion,
  review creation, dispute opening/resolution, message creation, product blocking, and
  user ban/warning/mute events.
- Migrated domain writes so timeline records and system chat messages are committed in the
  original transaction where applicable. Notifications, local realtime signals, BullMQ
  delivery, cache invalidation, and session revocation run from the durable outbox event.
- Notification delivery jobs use a stable SHA-256 BullMQ job ID derived from the event
  key. An outbox event is not marked processed unless its required queue handoff succeeds.
- Outbox cache invalidation and session revocation use strict Redis mutations, so a failed
  command keeps the event retryable. Existing request paths retain their best-effort cache
  behavior.
- Non-outbox notification delivery is now fire-and-forget after its database row is
  persisted. Redis, email, Telegram, WebSocket, or BullMQ availability no longer changes
  the HTTP result of the already committed business operation.
- Added outbox processed/failed counters, pending count, and oldest-pending-event age
  metrics, plus worker enablement, polling, batch, concurrency, retry, lock, and delivery
  timeout configuration in both example environments and Compose.

### Regression coverage

1. Rolling back the business transaction also rolls back its outbox row.
2. An order request succeeds and commits while the injected side-effect dependency is
   unavailable; its event remains pending and is delivered after recovery.
3. Reprocessing the same event does not create a second notification or BullMQ identity.
4. Two worker replicas concurrently drain one event set without processing duplicates.
5. Batch processing respects configured parallelism.
6. Failures increment attempts, retain the last error, use exponential availability
   delays, enter `failed` at the limit, and can be manually retried.
7. Pending count and oldest-event-age metrics reflect the durable queue.

### Verification

| Command | Result |
| --- | --- |
| `cd backend && npm run lint` | PASS |
| `cd backend && npm run build` | PASS |
| Targeted outbox/cache/notification run | PASS, 24/24 |
| `cd backend && npm test` | PASS, 202/202 in 20/20 files |
| Clean database migration smoke | PASS, all 33 migrations |
| Required outbox indexes on clean database | PASS, all present |
| Outbox reliability tests on clean database | PASS, 6/6 |
| `cd frontend && npm run typecheck` | PASS |
| `cd frontend && npm test` | PASS, 6/6 |
| `cd frontend && npm run i18n:check` | PASS, 0 errors and 25 baseline warnings |
| `cd frontend && npm run build` | PASS, with existing Sentry/OpenTelemetry warnings |
| `docker compose config --quiet` | PASS |

### Remaining constraints

- Realtime delivery currently targets sockets attached to the process that handles the
  event. A dedicated worker has no local sockets, and an API replica cannot reach sockets
  on another replica. Stage 11 must distribute these signals through Redis Pub/Sub.
- Notification rows and BullMQ jobs are deduplicated. A local WebSocket broadcast remains
  at-least-once: a crash after broadcast but before marking the event processed may emit
  it again.
- Legacy notification producers that have not moved to a domain event persist the
  in-app notification but do not yet have a durable retry for a failed BullMQ handoff.
- Outbox age gauges are refreshed by an enabled outbox worker. Deployments that disable
  every worker retain durable rows but do not update those gauges until a worker starts.

## Stage 10: order, message, and review idempotency

Status: complete.

Planned commit: `feat(core): add idempotency for orders messages and reviews`

### Confirmed defects

- Retrying order creation after a timeout could create multiple orders, conversations,
  timeline entries, and outbox events because the request had no durable identity.
- HTTP and WebSocket message delivery used separate request paths without a shared
  client-generated database identity, so reconnect retries could persist duplicates.
- Retrying an identical review surfaced the database uniqueness conflict instead of the
  existing review, while concurrent retries had no explicit application contract.

### Implementation

- Added `idempotency_keys`, uniquely scoped by user, operation, and UUID key. It stores a
  canonical SHA-256 request hash, processing/completed state, response status/body,
  resource ID, creation time, and 24-hour expiry.
- Order key claiming, order/conversation creation, system and timeline messages, outbox
  insertion, and completion of the saved response now share one PostgreSQL transaction.
  A matching retry replays the stored `201` response; a changed body returns `409`; a
  committed unfinished key reports `idempotency_in_progress`.
- Added bounded lazy cleanup for expired keys and an expiry index.
- Added `messages.client_message_id` with a partial unique index on sender and client ID.
  HTTP and WebSocket now call the same message service. Matching retries return the
  existing row, while changed content returns `409`; only the first insert emits outbox.
- The browser keeps one order idempotency UUID across failed retries and reuses the
  optimistic chat message UUID in its HTTP fallback.
- Review creation locks the order, returns an identical existing review with `200`, and
  rejects a changed rating or comment with `409`. Duplicate attempts do not add timeline
  or outbox rows.

### Regression coverage

1. Two concurrent order requests with one key create one order and replay one response.
2. Reusing an order key with another body returns `409`; missing and unfinished keys have
   explicit errors.
3. Retrying a WebSocket-originated message through HTTP returns one stored message and
   one outbox event.
4. An identical review retry returns the same review; a changed retry returns `409`.
5. Replayed order, message, and review operations do not duplicate outbox-driven
   notifications.

### Verification

| Command | Result |
| --- | --- |
| `cd backend && npm run lint` | PASS |
| `cd backend && npm run build` | PASS |
| Targeted idempotency/chat/outbox run | PASS, 29/29 |
| `cd backend && npm test` | PASS, 206/206 in 21/21 files |
| Clean database migration smoke | PASS, all 34 migrations |
| Required idempotency/message indexes on clean database | PASS, all present |
| Idempotency tests on clean database | PASS, 4/4 |
| `cd frontend && npm run typecheck` | PASS |
| `cd frontend && npm test` | PASS, 6/6 |
| `cd frontend && npm run i18n:check` | PASS, 0 errors and 25 baseline warnings |
| `cd frontend && npm run build` | PASS, with existing Sentry/OpenTelemetry warnings |
| `docker compose config --quiet` | PASS |

### Remaining constraints

- Order request results expire after 24 hours. Cleanup is bounded and runs lazily during
  new idempotent order requests rather than through a dedicated maintenance job.
- Request-level idempotency is currently implemented for order creation. Other mutating
  endpoints still need explicit contracts before using the generic transaction helper.
- Review equality is exact after schema parsing, including comment whitespace.
