# Final production-hardening report

This report is an evidence ledger, not a production-readiness certificate. It preserves
historical hardening evidence while binding current claims to an explicit input tree. The
snapshot was captured on 2026-08-01: the prompt-prior checkpoint was `7043159`, execution
started at `a7553a2`, and the Stage 3 baseline input was a clean `main`/`origin/main` at
`364547c`. The SHA `364547c` identifies the tree inspected before this documentation edit;
it is not a self-reference to a later documentation commit.

## 1. Executive summary

The history through `364547c` contains the planned frontend test and reliability work,
runtime separation, Docker and CI gates, isolated Playwright coverage, multilingual search,
session and money-boundary fixes, durable payment/storage follow-up, bounded pagination,
WebSocket race handling, centralized order transitions, canonical marketplace contracts,
and the local Graphify pilot with scoped agent instructions.

Two GitHub Actions runs provide current CI evidence: run `30697353208` at `23f5b28` and
run `30697861790` at `364547c` both completed with all 9 jobs passing. This is strong CI
evidence for the exact checks listed in section 5, but it is not staging or production
evidence. Production-sized migration behavior, rollback/down paths, the final search
benchmark, runtime failure drills, and real provider integrations remain unverified.

The input tree is therefore **not certified production-ready**.

Snapshot:

| Item | Value |
| --- | --- |
| Historical hardening base | `36ea677` |
| Prompt-prior checkpoint | `7043159` (`chore(security): document secret scan placeholder exception`) |
| Actual execution start | `a7553a2` (`chore(devx): install scoped Graphify pilot`) |
| Stage 3 baseline input | `main` and `origin/main` at `364547c` |
| Input working-tree state | Clean before the Stage 3 documentation edits |
| Delivery model | Direct commits to `main`, as requested for this task |
| Readiness | Not certified; staging and production-provider evidence remain open |

## 2. Commits

The following is the chronological hardening history retained from `36ea677` through the
Stage 3 input SHA `364547c`:

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
| `dab02a8` | Add shared marketplace contracts, DTO mappers, synchronization tests, and the first closeout documentation. |
| `09a827b` | Align the earlier closeout documents with the then-current main snapshot. |
| `6f98673` | Complete canonical marketplace contract boundaries across backend routes, shared contracts, frontend consumers, and synchronization tests. |
| `c38e7a5` | Resolve request-context, audit-redaction, fixture, and backend validation defects. |
| `926d31a` | Resolve frontend auth-refresh, cached-auth, chat, and marketplace navigation reliability defects. |
| `ae74285` | Resolve runtime cleanup, shutdown, Compose, and frontend image defects found during validation. |
| `71db37b` | Checkpoint order DTO, API refresh-race, seller flow, and E2E hardening fixes. |
| `36c318d` | Resolve critical marketplace E2E regressions in ledger and DTO behavior. |
| `f96588c` | Provide the release-migration encryption key required by CI. |
| `7043159` | Document the narrowly scoped secret-scan placeholder exception. |
| `a7553a2` | Install the project-scoped Graphify pilot and repository ignore policy. |
| `23f5b28` | Complete local semantic Graphify coverage for code, SQL, documents, and tracked images. |
| `364547c` | Add scoped Graphify navigation rules and risk-based verification requirements. |

`git log --reverse --oneline dab02a8..364547c` returned exactly the 12 commits from
`09a827b` through `364547c` shown above. `git log --oneline --all` also confirmed that all
referenced commit objects exist.

## 3. Root causes and implemented corrections

| Area | Root cause established by the hardening history | Implemented correction |
| --- | --- | --- |
| Authentication | Transient `/auth/me` failures and stale JWT/socket state could be interpreted independently from the durable user session epoch. | Preserve degraded authenticated state; validate session version for HTTP, refresh, 2FA completion, and WebSocket use. |
| Money | Number conversion and locale/UI remounts could lose integer-cent precision or in-progress state. | Keep cents as integer/string-safe values at boundaries and centralize frontend money/currency handling. |
| Queries | Several screens had no explicit error/retry contract, while some authenticated lists remained offset-based or unbounded. | Add stable error/retry components and cursor pagination with maximum limits and supporting indexes. |
| Payments | Provider capture/webhook completion could succeed before all durable follow-up intent was recorded; transient webhook failures lacked one consistent retry outcome. | Persist capture/outbox state transactionally and classify transient webhook failures for retry. Further provider-boundary work remains in the follow-on plan. |
| Storage | Provider writes/deletes and database quota state could diverge after a crash. | Add durable `uploading`/`deleting` intents and retry deletion through the outbox. |
| Order lifecycle | Status checks and writes were distributed across routes, payment handlers, jobs, and dispute resolution. | Centralize row locking, transition authorization, timestamps, timeline, outbox, and system messages in `transitionOrder`. |
| Runtime | One startup path coupled HTTP and background work, and migration behavior depended on application runtime configuration. | Add separate API/worker/outbox entrypoints and one advisory-locked release migration command. Audit-write draining before pool shutdown remains open. |
| Realtime | The initial-message ACK and client-ID lifecycle had race/identity gaps; concurrency bounds were not directly proven. | Fix first ACK and ID retention and add shutdown/race/concurrency tests. Cross-tab refresh fallback remains open. |
| Search | English FTS plus broad `ILIKE` did not cover catalog aliases, Cyrillic/Latin variants, or typo ranking with indexed candidates. | Maintain normalized search documents/terms with `pg_trgm`, `unaccent`, aliases, deterministic tiers, and historical load-plan evidence. |
| API contracts | Shared types and public DTO boundaries could drift between backend and frontend consumers. | Complete canonical shared contracts, explicit backend mappers, the frontend mirror, and synchronization tests in `6f98673`. |
| Agent navigation | Repeated broad repository scans consumed time and could hide the confidence of inferred dependencies. | Add a local Graphify pilot and scoped `AGENTS.md` rules; graph output remains advisory and every material edge must be checked in source. |

## 4. Migrations

| Migration | Purpose | Rollout and rollback facts |
| --- | --- | --- |
| `1784752500000_add-storage-operation-states.sql` | Add durable `uploading` and `deleting` states, validated constraints, and a cleanup-intent index. | Apply before the matching API/worker version. On rollback, stop writers and drain deletion events; remaining operation rows become `quarantined`. The replacement partial index is transactional and can require a maintenance window on a large table. |
| `1784909494965_add-multilingual-product-search.sql` | Install `pg_trgm`/`unaccent`, add category aliases, search document/term tables, indexes, maintenance triggers, alias data, and a bounded 1,000-product backfill. | Verify provider extension permissions before release. The release runner wraps the migration in one transaction. Roll back application code first; the down migration removes search objects and category aliases but intentionally retains extensions and backfilled game aliases. |
| `1784909600000_add_bounded_list_indexes.sql` | Support keyset pagination for product/seller favorites, seller products, blocks, and user/message reports. | Standard reversible index-only change; six indexes are dropped by the down section. |

Clean-database migration deployment, a second no-op deployment, and the schema-contract test
passed in CI at both `23f5b28` and `364547c`. Migration rollback/down rehearsal is
**NOT RUN**. Production-role extension checks and the final search benchmark are also
**NOT RUN**.

## 5. Evidence by scope

Evidence is intentionally separated by environment. `PASS` in one category must not be
copied into another category.

### 5.1 Historical evidence

- Commits from `36ea677` through `7043159` retain implementation and test history, but a
  result observed on an older SHA is not automatically a current-tree result.
- Commit `958e9d0` records the earlier local 20k-row `EXPLAIN ANALYZE` search evidence.
  That evidence is useful for design history; it is not the final search benchmark on
  `364547c` or a production-sized clone.
- The older `dab02a8`/`codex/final-hardening-closeout` snapshot is historical only. It no
  longer describes the current branch, input SHA, or CI state.

### 5.2 Current-tree evidence

| Check | Bound SHA | Status and observed result |
| --- | --- | --- |
| `git status --short --branch` | `364547c` before Stage 3 edits | **PASS** — `main...origin/main`, with no working-tree entries. |
| `git rev-parse HEAD`, `main`, and `origin/main` | `364547c` before Stage 3 edits | **PASS** — all resolved to `364547c8e798f4da4fdafa185b6546d280d39311`. |
| `git log --reverse --oneline dab02a8..364547c` | `364547c` | **PASS** — 12 commits, listed in section 2. |
| Initial Graphify semantic pilot captured in the repository report | `23f5b28` | **PASS as navigation-tool evidence** — 528 files detected, 49/49 document/image files covered, 3,098 initial final nodes, 8,424 initial final edges, and no final graph-health warnings. |
| `graphify update .` | `23f5b28` | **PASS as incremental-tool evidence** — 15.43 seconds, topology unchanged. |
| Current local Graphify incremental snapshot | `364547c` | **PASS as navigation-tool evidence** — 535 files, 3,176 nodes, 8,571 edges, 13 hyperedges, 179 named communities, and 0 graph-health warnings. Generated output remains ignored. |
| Local backend/frontend/Docker/E2E gate rerun | `364547c` | **NOT RUN locally** — use the separate CI evidence below; do not describe CI as a local rerun. |

The complete Graphify measurements and their raw-extraction caveats are recorded in
[`graphify-pilot.md`](graphify-pilot.md). Graphify output is navigation evidence, not proof
of correctness, authorization, transaction safety, or production readiness.

### 5.3 CI evidence

| Input SHA | GitHub Actions run | Result |
| --- | --- | --- |
| `23f5b28` | [CI run 30697353208](https://github.com/spacour1/skrynia-2.0/actions/runs/30697353208) | **PASS — 9/9 jobs succeeded** |
| `364547c` | [CI run 30697861790](https://github.com/spacour1/skrynia-2.0/actions/runs/30697861790) | **PASS — 9/9 jobs succeeded** |

The current-input run at `364547c` covered:

| Job | Exact repository gate covered | Status |
| --- | --- | --- |
| `backend` | `npm ci`; production build; clean `migrate:deploy`; repeated `migrate:deploy`; lint/typecheck; schema-contract test; full backend tests | **PASS**, 3m 30s |
| `frontend` | `npm ci`; typecheck; i18n contract; unit tests; production build | **PASS**, 1m 24s |
| `audit-policy-tests` | Node test suite for the npm-audit policy | **PASS**, 9s |
| `dependency-audit (backend)` | Production dependency audit evaluated through the repository policy | **PASS**, 15s |
| `dependency-audit (frontend)` | Production dependency audit evaluated through the repository policy | **PASS**, 20s |
| `dependency-audit (e2e)` | Production dependency audit evaluated through the repository policy | **PASS**, 12s |
| `secret-scan` | Pinned Gitleaks 8.30.1 scan of complete repository history | **PASS**, 7s |
| `docker` | `docker compose --profile '*' config --quiet` and production image build | **PASS**, 1m 52s |
| `e2e` | Isolated E2E Compose validation and Chromium suite through `node e2e/scripts/run.mjs` | **PASS**, 3m 50s |

The dependency jobs passing means the configured policy passed; it does not mean there are
zero advisories. The E2E job also emitted a non-failing GitHub runner warning that the
pinned `actions/upload-artifact` action targets deprecated Node.js 20 and was forced onto
Node.js 24. The standalone development Compose file is not separately proven by these CI
steps.

### 5.4 Staging evidence

**NOT RUN for `364547c`.** There is no current-SHA staging evidence for restart and ordered
shutdown, audit draining, Redis loss, provider outage, rolling deployment, multi-replica
behavior, production-sized migrations/search, connection-pool capacity, or extension
permissions. Historical k6 workflow failures on older commits are not evidence for the
current input tree and must not be converted to either `PASS` or current-tree `FAIL`.

### 5.5 Production-provider evidence

**NOT RUN and outside automated test scope.** Real payment, email, SMS, Telegram, and
S3-compatible storage providers were not called. No real credentials were used. Mock or
test-provider success must not be reported as real-provider success.

## 6. Security

Implemented controls include durable session-version revocation, one-time WebSocket
tickets/session checks, bounded WebSocket work, strict test-payment gating
(`NODE_ENV=test` and `ENABLE_TEST_PAYMENTS=true`), non-root production images, narrowly
scoped Gitleaks fingerprints, and an audit policy that rejects unexpected, escalated, or
expired high/critical findings.

CI Gitleaks evidence is green at `364547c`, with the three exact documentation-placeholder
fingerprints described in
[`security/secret-scan-allowlist.md`](security/secret-scan-allowlist.md). The dependency
policy is also green, but it intentionally carries 12 exact high-advisory exceptions: one
backend Sharp exception and 11 frontend exceptions covering Next.js and transitive
Sentry/build dependencies. All expire on 2026-08-21. The details and remediation rules are
in [`security/npm-audit-debt.md`](security/npm-audit-debt.md). These exceptions are tracked
debt, not a clean security audit.

Uploaded objects are magic-byte validated, but malware scanning remains unimplemented.
Real provider credentials and calls remain excluded from automated validation.

## 7. Reliability

The history adds durable outbox-backed payment/storage follow-up, bounded transaction and
webhook retries, cursor pagination, explicit frontend degraded/error/retry states,
currency-draft preservation, locale-aware formatting, ordered process shutdown, bounded
health probes, worker/outbox readiness heartbeats, first-message ACK coverage, and one
central order transition boundary.

The isolated E2E topology uses clean PostgreSQL/Redis volumes, separate API/worker/outbox
processes, a production Next.js image, one Chromium worker, unique run data, and failure
artifacts. It passed in both cited CI runs. CI does not prove runtime behavior under real
shutdown timing, rolling deploys, Redis/provider outages, or multiple replicas; those need
staging observation.

## 8. API contracts

Commit `dab02a8` introduced shared Product, Order, Message, DisputeMessage, and Seller
contracts, explicit backend DTO mappers, a synchronized frontend mirror, and contract
tests. Commit `6f98673` then completed the canonical marketplace contract boundaries across
routes and consumers and expanded mapper/synchronization coverage.

The backend and frontend jobs, including their full test suites, passed on the exact
`364547c` input tree. This supports a current CI claim for the committed contract suite; it
does not prove provider behavior, staging compatibility, or the absence of every future
internal-field regression.

## 9. Deployment plan

1. Complete the open hardening stages and select a release-candidate SHA; do not reuse
   `364547c` evidence for later code without checking the diff and rerunning the applicable
   gates.
2. Remove or explicitly re-accept each dependency advisory before its expiry; never bypass
   the audit policy.
3. Verify `pg_trgm` and `unaccent` availability with the production database role.
4. Back up the database and record row counts, database size, and migration timeouts.
5. Rehearse rollback/down behavior on a production-like copy, then run exactly one
   `npm run migrate:deploy` release job. Do not run migrations from API, worker, or outbox
   startup.
6. Deploy worker and outbox commands with unique `RUNTIME_INSTANCE_ID` values, then roll
   out API replicas and the frontend.
7. Keep `ENABLE_TEST_PAYMENTS` false/unset and keep real provider credentials out of E2E.
8. Gate traffic on `/health/ready`; use `/health/live` only for liveness.
9. Smoke authentication/refresh/logout, listing/search, chat ACK, an escrow-independent
   order flow, dispute access, and admin financial authorization.
10. Observe audit draining, restart/shutdown, Redis loss, provider failure, rolling deploy,
    and multi-replica behavior before approving production rollout.
11. Monitor PostgreSQL transaction/lock age, search latency/table size, Redis readiness,
    outbox failures, queue lag, WebSocket disconnects, storage cleanup intents, and error
    rates. Roll back application code before a database down migration.

## 10. Remaining risks and readiness decision

- The follow-on hardening plan has no closure evidence yet for bounded production audit
  draining before PostgreSQL pool shutdown.
- Redis/cache invalidation still requires a verified post-commit boundary for financial
  order transitions; provider/network work must remain outside database transactions.
- Cross-tab refresh without Web Locks and offline-logout retry semantics remain open.
- Manual-payment GET side effects, provider verification/settlement boundaries, amount and
  currency checks, and durable confirmation uniqueness still require dedicated closure.
- The TOTP/2FA lifecycle and KeepGame product-facing naming audit remain open stages.
- Sharp, Next.js, and Sentry/build-chain high advisories remain accepted only through
  2026-08-21; CI policy success is not equivalent to remediation.
- Migration rollback/down paths, provider extension permissions, and the final search
  benchmark are **NOT RUN** for the input tree.
- Staging restart, shutdown, Redis outage, provider outage, rolling-deploy, multi-replica,
  and production-capacity evidence is **NOT RUN**.
- Malware scanning for uploaded content is not implemented.
- Real payment, email, SMS, Telegram, and S3 provider behavior is not covered by CI/E2E.
- A single-host local upload volume cannot be shared by scaled API replicas; multi-replica
  production requires shared object storage.
- Read replicas are not implemented; capacity targets still require production-like load
  and connection-pool validation.
- Graphify improves navigation but does not replace source review, tests, authorization
  review, financial invariants, runtime traces, or deployment evidence.

**Readiness decision: NOT CERTIFIED FOR PRODUCTION.** CI is green for `364547c`, but the
staging, provider, rollback, security-debt, and follow-on implementation evidence above is
still incomplete.
