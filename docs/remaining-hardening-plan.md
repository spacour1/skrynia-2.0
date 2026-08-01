# Remaining production-hardening plan

This tracker captures the current master-plan execution baseline as of 2026-08-01.
It is not a production-readiness certificate. Stage numbers in this document refer to
the current master plan, not to the earlier hardening-stage numbering retained in
[`current-hardening-baseline.md`](current-hardening-baseline.md) and
[`final-hardening-report.md`](final-hardening-report.md).

## Execution snapshot

| Fact | Captured value | Meaning |
| --- | --- | --- |
| Capture date | `2026-08-01` | Date of this execution-baseline update. |
| Prior prompt SHA | `7043159c6017939769336a32154bade127351d39` | Last committed SHA supplied by the preceding hardening prompt. |
| Verified plan execution start | `a7553a2f833a417116a7b91dba0b2c7893bbb66a` | HEAD verified when the current master-plan execution began. |
| Stage 3 input `main` | `364547c8e798f4da4fdafa185b6546d280d39311` | Local `main` before this documentation edit. |
| Stage 3 input `origin/main` | `364547c8e798f4da4fdafa185b6546d280d39311` | Remote-tracking baseline before this documentation edit. |
| Input working tree | Clean | `git status --short` produced no output before the Stage 3 edit. |
| Input branch divergence | `0 0` | `origin/main...main` had no commits unique to either side. |
| Production readiness | **NOT CERTIFIED** | Green CI is necessary evidence, but staging and production-provider evidence are still absent. |

The clean-tree statement above describes the input to this update. This file becomes a
working-tree change until the Stage 3 documentation commit is created.

## Completed current-plan stages

| Stage | Status | Evidence and boundary |
| --- | --- | --- |
| 0 - preflight and baseline | Completed | Repository/tool preflight and the Git baseline were captured. The execution-start HEAD was verified as `a7553a2`; this status does not substitute for the final D5 run. |
| 1 - local Graphify pilot | Completed | `a7553a2` installs the project-scoped local pilot; `23f5b28` records and completes it in [`graphify-pilot.md`](graphify-pilot.md). Generated `graphify-out/` data remains local navigation evidence, not correctness evidence. |
| 2 - scoped `AGENTS.md` | Completed | `364547c` adds the scoped ownership/navigation instructions and risk-based verification rules. |
| 3 - hardening execution baseline | Completed for this tracker | This document records the actual start, current Stage 3 input SHA, evidence boundaries, remaining stages, and unresolved risks. Cross-document final reconciliation remains part of Stage 20. |

## Evidence status at the Stage 3 input

### Historical evidence

The old closeout snapshot ended at `dab02a8`. The Stage 3 input contains all 12
subsequent commits, in chronological order:

| Commit | Change |
| --- | --- |
| `09a827b` | `docs(hardening): align closeout baseline with current main` |
| `6f98673` | `fix(api): complete canonical marketplace contract boundaries` |
| `c38e7a5` | `fix(backend): resolve final hardening validation defects` |
| `926d31a` | `fix(frontend): resolve final reliability validation defects` |
| `ae74285` | `fix(ops): resolve final runtime and shutdown defects` |
| `71db37b` | `chore: checkpoint marketplace hardening work` |
| `36c318d` | `fix(e2e): resolve critical marketplace flow regressions` |
| `f96588c` | `fix(ci): provide release migration encryption key` |
| `7043159` | `chore(security): document secret scan placeholder exception` |
| `a7553a2` | `chore(devx): install scoped Graphify pilot` |
| `23f5b28` | `docs(devx): complete local Graphify pilot` |
| `364547c` | `docs(agents): add scoped Graphify and risk-based verification rules` |

The results recorded before `364547c` remain historical evidence for their own
trees. They must not be promoted to current-tree, staging, or provider evidence.

### Current-tree evidence

- Local `main` and `origin/main` both resolved to `364547c8e798f4da4fdafa185b6546d280d39311`.
- The working tree was clean before this documentation edit, and the branch divergence
  count was `0 0`.
- The current-plan commits present in that tree are `a7553a2` (project-scoped Graphify
  installation), `23f5b28` (pilot completion), and `364547c` (scoped agent rules).
- These observations prove repository state only. They do not prove runtime behavior,
  provider behavior, migration rollback safety, or production readiness.

### CI evidence

GitHub Actions [CI run 30697861790](https://github.com/spacour1/skrynia-2.0/actions/runs/30697861790)
for `364547c8e798f4da4fdafa185b6546d280d39311` completed successfully with **9/9 jobs
PASS**:

| CI area | Observed result |
| --- | --- |
| Backend | Build, clean-database release migration, repeated no-op release migration, lint, schema-contract tests (7/7), and the full test suite (488/488 in 55 files) passed. |
| Frontend | Typecheck, i18n validation, tests (62/62 in 14 files), and production build passed. |
| Docker | `docker compose --profile '*' config --quiet` and the profiled production image build passed. |
| E2E | E2E Compose validation and the isolated Playwright run passed (5/5). |
| Audit policy | The audit-policy test job passed. |
| Dependency audits | Backend, frontend, and E2E audit jobs passed under the repository's documented exception policy; this does not mean that the dependency trees contain zero advisories. |
| Secret scan | The pinned full-history Gitleaks job passed with `no leaks found`. |

This CI result is current-tree CI evidence. It is not evidence for migration down/rollback,
a final-schema search benchmark, staging runtime scenarios, or real external providers.
It also does not replace a final D5 run on the later release SHA.

### Staging evidence

**NOT RUN.** No Stage 16 operational evidence has been captured for API, worker, or
outbox shutdown; Redis/PostgreSQL interruption; rolling deployment; production-scale
search rollout (including production-role permissions for `pg_trgm` and `unaccent`);
or multi-replica behavior. Deployment status checks alone must not be reclassified as
staging validation.

### Production-provider evidence

**NOT RUN.** No real payment, email, SMS, Telegram, or S3 provider behavior was
validated in this execution. Automated mocks and CI tests must not be reported as
production-provider evidence.

## Remaining current-plan stages

All stages below remain open. Existing implementation may provide a starting point, but
an item is not complete until its required change and stated evidence are both recorded.

| Stage | Remaining scope | Required completion evidence |
| --- | --- | --- |
| 4 - production audit drain | Ensure pending response-finish audit inserts are drained before the PostgreSQL pool closes during shutdown, with bounded and idempotent drain behavior. | Targeted concurrency/error/shutdown tests, full backend D4 gate, Docker shutdown smoke, and an updated graph. |
| 5 - post-commit financial cache invalidation | Remove Redis work from financial DB transaction callbacks; centralize post-commit invalidation for order detail/list and buyer/seller wallet caches, with explicit Redis-failure semantics. | Targeted order/ledger/cache tests, full backend D4, critical financial E2E, and graph update. |
| 6 - cross-tab auth refresh | Coordinate refresh-token rotation across tabs when Web Locks is unavailable, covering BroadcastChannel/storage fallback and every session-rotation path. | Unit race tests, multi-context browser tests, frontend D2, and auth E2E. |
| 7 - offline logout | Make the UI anonymous immediately, notify other tabs, retain a bounded pending-logout marker, retry server revocation after recovery, and prevent cached-user resurrection before a server check. | Offline/recovery/cross-tab unit tests, frontend D2, and auth E2E; documentation must distinguish local logout from server-side revocation. |
| 8 - Sharp/libvips dependency remediation | Upgrade Sharp/libvips compatibly and remove the corresponding high advisory without breaking upload validation or image processing. | Before/after audit evidence, upload-pipeline tests, backend D4, production image build, and secret scan. |
| 9 - Next.js dependency remediation | Move the frontend to a supported patched Next.js version while preserving App Router, middleware, rewrites, standalone output, and React compatibility. | Frontend tests/build, production Docker build, E2E, and removal of the resolved audit-debt entry. |
| 10 - Sentry/build-tool dependency remediation | Close the remaining high advisories in the Sentry, webpack, Rollup, and transitive build chain using compatible versions. | Observability/build-path checks, frontend D2, Docker build, E2E, and exact audit-debt reconciliation. |
| 11 - manual payment `POST` | Remove side effects from manual-payment `GET` routes and expose an idempotent state-changing `POST` contract, updating shared/frontend consumers and compatibility behavior. | Route/contract/idempotency tests, backend D4, frontend D2, and payment E2E using only the gated mock flow. |
| 12 - provider callback invariants | Keep external provider verification outside DB transactions and persist idempotent settlement, order, wallet, ledger, and outbox state atomically inside the transaction. | Callback/retry/duplicate/failure tests, full backend D4, migration checks if schema changes, and mock-provider E2E. |
| 13 - KeepGame naming cleanup | Use `KeepGame` for product-facing naming, retain `Skrynia 2.0` as the repository codename, and preserve legacy internal identifiers where renaming would add migration risk. | Repository naming scan plus frontend/backend/build checks demonstrating no accidental internal or schema rename. |
| 14 - 2FA/TOTP review | Review RFC 6238 settings, encrypted secret lifecycle, verification windows and replay behavior, session-version invalidation, disable/reset flows, and backup-code handling. | Focused lifecycle/security tests, backend D4, and 2FA auth E2E. |
| 15 - performance baseline | Add a reproducible, documented non-production dataset and read/write scenarios with latency, throughput, error, and resource metrics. | Versioned scenario documentation and a recorded baseline with environment characteristics; no production data or real provider traffic. |
| 16 - staging/runtime validation | Observe API/worker/outbox shutdown, Redis/PostgreSQL loss, rolling deployment, search rollout, and relevant multi-replica behavior in an isolated staging environment. | Timestamped commands, environment/SHA, logs, metrics, and PASS/FAIL/BLOCKED outcomes. Production-destructive tests are forbidden. |
| 17 - Graphify A/B pilot | Run the separate controlled A/B evaluation across at least 12 cross-domain, contract, and leaf tasks. The completed Stage 1 installation pilot does not satisfy this measurement stage. | Per-task time/files/accuracy evidence, aggregate decision criteria, and an updated [`graphify-pilot.md`](graphify-pilot.md). |
| 18 - permanent Graphify integration | If Stage 17 succeeds, choose local-only versus selected committed output, finalize incremental-update/hook policy, and retain Codex-compatible advisory rules. | Documented decision, clean ignore/output policy, working update/query smoke tests, and no sensitive or machine-specific graph data. |
| 19 - final D5 release validation | Run the complete backend, migration, frontend, Compose, image, E2E, audit-policy, dependency-audit, secret-scan, search, and graph gates on one recorded final SHA. | Exact commands, exit statuses, test counts, final SHA/remote SHA, and preserved failure evidence. No earlier CI run substitutes for this gate. |
| 20 - final documentation | Reconcile the baseline, remaining plan, final report, Graphify pilot, and performance report against the final D5 SHA. | Separate historical/current-tree/CI/staging/provider evidence; no unexplained PASS, and no production-ready claim while any release gate is FAIL, BLOCKED, or NOT RUN. |

## Residual risks

- Production PostgreSQL must permit `pg_trgm` and `unaccent`; otherwise the search
  release must stop before application rollout.
- Search backfill uses bounded statements, but the release runner uses one transaction.
  Locks, duration, data distribution, query plans, and latency still need measurement on
  production-scale data.
- High-advisory exceptions documented in
  [`security/npm-audit-debt.md`](security/npm-audit-debt.md) expire on 2026-08-21.
  Stages 8-10 must remove or explicitly reconcile them; passing the current policy is
  not the same as having zero advisories.
- Uploaded content is magic-byte validated but is not malware scanned.
- Real payment, email, SMS, Telegram, and S3 behavior remains outside automated
  validation.
- Multi-replica API deployment requires shared S3-compatible storage; a local volume is
  not shared across hosts.
- Read replicas and production capacity/load validation remain unverified.

## Ongoing constraints

- Do not call real payment providers from automated tests; use only the explicitly
  gated mock flow.
- Run migrations through the release job, never from API, worker, or outbox startup.
- Do not claim `PASS` unless the exact command completed successfully on the stated
  tree. Keep local, CI, staging, and provider evidence separate.
- Treat Graphify as a navigation aid, not proof of authorization, transaction, ledger,
  migration, or runtime correctness.
- Do not describe the application as production-ready until Stage 19 and Stage 20 close
  every required release gate with attributable evidence.
