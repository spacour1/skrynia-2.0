# Final production-hardening report

This report is an evidence ledger for the hardening branch, not a production-readiness
certificate. It was prepared from committed changes in `origin/main..42f3ddc`. The final
commit SHA and the final validation results must be updated after the current working-tree
changes are committed.

## 1. Executive summary

The branch implements the planned frontend test foundation and reliability work,
production runtime separation, Docker and CI gates, an isolated Playwright stack, and
multilingual typo-tolerant marketplace search (Stages 8-13). It also includes follow-up
fixes for session epochs, exact money representation, payment/webhook recovery, durable
storage cleanup, bounded pagination, WebSocket acknowledgement/race handling, and one
central order-transition service.

The implementation is not yet certified for deployment. The final tree has not completed
the validation matrix in section 5, the API-contract consolidation was still partial at
the committed snapshot, and production-provider prerequisites and dependency exceptions
remain open. No real payment-provider implementation or validation was added.

Snapshot:

| Item | Value |
| --- | --- |
| Base | `origin/main` at `36ea677` |
| Committed snapshot | `42f3ddc` on `codex/finish-big-plan` |
| Final HEAD | **NOT RECORDED - update after the final commit** |
| Final working-tree state | **NOT RUN - confirm clean before publication** |

## 2. Commits

The following is the complete chronological `origin/main..42f3ddc` history at the
documentation snapshot:

| Commit | Purpose |
| --- | --- |
| `acb5cfb` | Refresh the pre-Stage-8 hardening baseline. |
| `3697ea2` | Add Vitest, React Testing Library, jsdom, deterministic mocks, and coverage. |
| `3bb42d1` | Enforce the durable session epoch across HTTP, WebSocket, and 2FA completion. |
| `925af5d` | Preserve authenticated UI state during transient API failures. |
| `567c052` | Use semantic, keyboard-accessible marketplace links. |
| `65dfb7e` | Map public order mutation responses instead of exposing database rows. |
| `7e7e86a` | Persist payment capture events and retry transient webhook failures. |
| `a89581c` | Make upload/create/delete cleanup durable and crash recoverable. |
| `da934c2` | Make marketplace query handling compatible with Suspense. |
| `49db14e` | Preserve exact money values and draft state across currency changes. |
| `0d9dd52` | Add explicit query error and retry states. |
| `875a650` | Preserve integer money cents at API/provider boundaries. |
| `b398e60` | Format marketplace data with the active locale. |
| `0c75d63` | Complete bounded pagination and propagate trace context through retries. |
| `2746d42` | Split API, BullMQ worker, outbox, and release-migration runtimes. |
| `26b619b` | Harden production images, process signals, healthchecks, and runtime users. |
| `0f1c225` | Add frontend, migration, Docker, audit-policy, secret-scan, and E2E CI gates. |
| `df87afb` | Ensure the first realtime chat message receives an acknowledgement. |
| `81972bb` | Limit release migrations to their own validated configuration. |
| `958e9d0` | Add multilingual normalized search, aliases, indexes, triggers, tests, and load evidence. |
| `7fb46eb` | Keep demo products consistent with catalog schemas. |
| `c68aa21` | Generate and retain valid realtime client identifiers. |
| `d3db9a5` | Add isolated Playwright coverage for marketplace, dispute, moderation, session, and reliability flows. |
| `419e095` | Prove the WebSocket concurrent-handler bound. |
| `070ad8c` | Correct money and session documentation contracts. |
| `5d44960` | Route order lifecycle writes through the centralized transition service. |
| `42f3ddc` | Add cursor bounds and indexes to the remaining authenticated lists. |

Final range audit: **NOT RUN - regenerate `git log --reverse origin/main..HEAD` after
the final commit and add any later commits above.**

## 3. Root causes

| Area | Root cause established by the branch | Implemented correction |
| --- | --- | --- |
| Authentication | Transient `/auth/me` failures and stale JWT/socket state could be interpreted independently from the durable user session epoch. | Preserve degraded authenticated state; validate session version for HTTP, refresh, 2FA completion, and WebSocket use. |
| Money | Number conversion and locale/UI remounts could lose integer-cent precision or in-progress state. | Keep cents as integer/string-safe values at boundaries and centralize frontend money/currency handling. |
| Queries | Several screens had no explicit error/retry contract, while some authenticated lists remained offset-based or unbounded. | Add stable error/retry components and cursor pagination with maximum limits and supporting indexes. |
| Payments | Provider capture/webhook completion could succeed before all durable follow-up intent was recorded; transient webhook failures lacked one consistent retry outcome. | Persist capture/outbox state transactionally and classify transient webhook failures for retry. |
| Storage | Provider writes/deletes and database quota state could diverge after a crash. | Add durable `uploading`/`deleting` intents and retry deletion through the outbox. |
| Order lifecycle | Status checks and writes were distributed across routes, payment handlers, jobs, and dispute resolution. | Centralize row locking, transition authorization, timestamps, timeline, outbox, and system messages in `transitionOrder`. |
| Runtime | One startup path coupled HTTP and background work, and migration behavior depended on application runtime configuration. | Add separate API/worker/outbox entrypoints and one advisory-locked release migration command. |
| Realtime | The initial-message ACK and client-ID lifecycle had race/identity gaps; concurrency bounds were not directly proven. | Fix first ACK and ID retention and add shutdown/race/concurrency tests. |
| Search | English FTS plus broad `ILIKE` did not cover catalog aliases, Cyrillic/Latin variants, or typo ranking with indexed candidates. | Maintain normalized search documents/terms with `pg_trgm`, `unaccent`, aliases, deterministic tiers, and load-plan evidence. |

## 4. Migrations

| Migration | Purpose | Rollout and rollback facts |
| --- | --- | --- |
| `1784752500000_add-storage-operation-states.sql` | Add durable `uploading` and `deleting` states, validated constraints, and a cleanup-intent index. | Apply before the matching API/worker version. On rollback, stop writers and drain deletion events; remaining operation rows become `quarantined`. The replacement partial index is transactional and can require a maintenance window on a large table. |
| `1784909494965_add-multilingual-product-search.sql` | Install `pg_trgm`/`unaccent`, add category aliases, search document/term tables, indexes, maintenance triggers, alias data, and a bounded 1,000-product backfill. | Verify provider extension permissions before release. The repository release runner still wraps the migration in one transaction. Roll back the API first; the down migration removes search objects and category aliases but intentionally retains extensions and backfilled game aliases. |
| `1784909600000_add_bounded_list_indexes.sql` | Support keyset pagination for product/seller favorites, seller products, blocks, and user/message reports. | Standard reversible index-only change; six indexes are dropped by the down section. |

Final migration validation (clean up, repeat/no-op, schema contracts, and rollback where
applicable): **NOT RUN - replace with exact commands and results.**

## 5. Tests

The following table is intentionally a final-tree checklist. Intermediate results are
not promoted to final evidence after later source changes.

| Check | Final status |
| --- | --- |
| `cd backend && npm run lint` | **NOT RUN** |
| `cd backend && npm run build` | **NOT RUN** |
| `cd backend && npm test` | **NOT RUN** |
| Clean-database migration up + schema-contract suite | **NOT RUN** |
| Repeated release migration/no-op check | **NOT RUN** |
| `cd frontend && npm run typecheck` | **NOT RUN** |
| `cd frontend && npm run i18n:check` | **NOT RUN** |
| `cd frontend && npm test` | **NOT RUN** |
| `cd frontend && npm run build` | **NOT RUN** |
| `docker compose config --quiet` for production | **NOT RUN** |
| `docker compose -f docker-compose.dev.yml config --quiet` | **NOT RUN** |
| `docker compose -f docker-compose.e2e.yml config --quiet` | **NOT RUN** |
| Production backend/frontend image builds | **NOT RUN** |
| `node e2e/scripts/run.mjs` | **NOT RUN** |
| Audit-policy unit test and production-dependency audits | **NOT RUN** |
| Gitleaks full-history scan | **NOT RUN** |
| Search benchmark rerun on the final schema | **NOT RUN** |

Record `PASS`, `FAIL`, `BLOCKED`, or `NOT RUN`, the exact command, and runner-reported
test counts. A GitHub Actions configuration change is not evidence that CI passed.

## 6. Security

Implemented controls include durable session-version revocation, one-time WebSocket
tickets/session checks, bounded WebSocket work, strict test-payment gating
(`NODE_ENV=test` and `ENABLE_TEST_PAYMENTS=true`), non-root production images, narrowly
scoped Gitleaks fingerprints, and an audit policy that rejects unexpected or expired
high/critical findings.

The dependency gate intentionally carries time-limited advisory exceptions documented in
`docs/security/npm-audit-debt.md`. At the snapshot, those exceptions expire at the end
of 2026-08-21 UTC and include direct/runtime exposure in Next.js and Sharp plus transitive
Sentry/build dependencies. They are tracked debt, not a clean security audit. Uploaded
objects are magic-byte validated, but malware scanning remains unimplemented.

No real payment credentials or provider calls belong in automated tests. Real payment,
email, SMS, Telegram, and S3 integrations remain outside automated validation.

## 7. Reliability

The branch adds durable outbox-backed payment/storage follow-up, bounded transaction and
webhook retries, cursor pagination, explicit frontend degraded/error/retry states,
currency-draft preservation, locale-aware formatting, ordered process shutdown, bounded
health probes, worker/outbox readiness heartbeats, first-message ACK coverage, and one
central order transition boundary.

The isolated E2E topology uses clean PostgreSQL/Redis volumes, separate API/worker/outbox
processes, a production Next.js image, one Chromium worker, unique run data, and failure
artifacts. This topology still needs the final run recorded in section 5. Production
restart, rolling deploy, Redis outage, provider outage, and multi-replica behavior require
staging observation; unit/integration coverage does not prove those operational properties.

## 8. API contracts

Committed changes improve order response mapping, exact money serialization, public seller
DTOs, pagination envelopes, locale consumption, and consistent order status handling.
They also remove several direct database-row response paths.

At `42f3ddc`, the earlier Stage 6 progress document still correctly described the complete
shared-contract goal as partial: one shared contract source and explicit DTO mappers/tests
for every public Product, Order, Message, DisputeMessage, and Seller shape were not yet all
committed. The final working tree contains contract-related work that is deliberately not
credited here until it is reviewed, committed, and tested.

Final contract scan and mapper/synchronization tests: **NOT RUN - update after the
contract closeout commit.**

## 9. Deployment plan

1. Produce a clean final commit and replace every `NOT RUN` entry in section 5 with
   factual evidence.
2. Remove or explicitly accept any failing security advisory; do not bypass the policy.
3. Verify `pg_trgm` and `unaccent` availability with the production database role.
4. Back up the database and record row counts, database size, and migration timeouts.
5. Run exactly one `npm run migrate:deploy` release job. Do not run migrations from API,
   worker, or outbox startup.
6. Deploy the separate worker and outbox commands with unique `RUNTIME_INSTANCE_ID`
   values, then roll out API replicas and the frontend.
7. Keep `ENABLE_TEST_PAYMENTS` false/unset and do not place real provider credentials in
   the E2E environment.
8. Gate traffic on `/health/ready`; use `/health/live` only for liveness.
9. Smoke authentication/refresh, listing/search, chat ACK, an escrow-independent order
   flow, dispute access, and admin financial authorization.
10. Monitor PostgreSQL transaction/lock age, search latency/table size, Redis readiness,
    outbox failures, queue lag, WebSocket disconnects, storage cleanup intents, and error
    rates. Roll back application code before a database down migration.

## 10. Remaining risks

- Final lint, build, migration, unit/integration, Docker, security, and Playwright
  verification is not yet recorded for the final tree.
- API contracts were partial at the committed snapshot; the in-progress closeout must be
  reviewed for accidental internal-field leakage and frontend/backend drift.
- Production PostgreSQL may not permit `CREATE EXTENSION`; search rollout must stop if
  `pg_trgm` or `unaccent` is unavailable.
- The search migration is batched but remains one release transaction; production-sized
  lock duration, data distribution, and query latency are not proven by the local 20k
  benchmark.
- Audit exceptions expire on 2026-08-21 and include deployed Next.js and Sharp code.
- Malware scanning for uploaded content is not implemented.
- Real payment, email, SMS, Telegram, and S3 provider behavior is not covered by CI/E2E.
- A single-host local upload volume cannot be shared by scaled API replicas; multi-replica
  production requires S3-compatible storage.
- Read replicas are not implemented; capacity targets still require production load and
  connection-pool validation.
- Direct production readiness, CI status, and deployment success must not be claimed until
  all placeholders above are replaced with observed results.
