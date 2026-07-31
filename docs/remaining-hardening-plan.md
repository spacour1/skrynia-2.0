# Remaining production-hardening plan

Stages 8-13 are implemented on `codex/finish-big-plan` through the committed
documentation snapshot `42f3ddc`. This document now tracks closeout and residual risk;
it is not a production-readiness certificate. Final status belongs in
[`final-hardening-report.md`](final-hardening-report.md) after every validation
placeholder is replaced with observed results.

## Implemented stages

| Stage | Implementation status | Evidence | Closeout still required |
| --- | --- | --- | --- |
| 8 - frontend test foundation | Implemented | `3697ea2`; Vitest, jsdom, React Testing Library, deterministic helpers, coverage, and retained realtime tests. | Run and record the final frontend suite and coverage policy. |
| 9 - frontend reliability | Implemented | `925af5d`, `567c052`, `da934c2`, `49db14e`, `0d9dd52`, `b398e60`; degraded auth, retry UI, state-preserving currency changes, semantic links, and locale formatting. | Final unit/build/E2E run on the committed tree. |
| 10 - production runtime and operations | Implemented | `2746d42`, `26b619b`, `81972bb`; separate API/worker/outbox entrypoints, release migrations, bounded health, ordered shutdown, non-root images, and signal handling. | Observe restart, shutdown, Redis loss, and rolling deployment in staging. |
| 11 - CI gates | Implemented in workflow | `0f1c225`; frontend tests, clean migrations/schema checks, Docker checks, audit policy, secret scan, and E2E jobs. | A workflow definition is not a green run; record the actual GitHub Actions result. |
| 12 - Playwright E2E | Implemented | `d3db9a5`, with `df87afb`, `c68aa21`, and `419e095` follow-ups; isolated Compose, five critical-flow specs, test-only payments, cleanup, and failure artifacts. | Run `node e2e/scripts/run.mjs` against the final tree and preserve failure evidence if it fails. |
| 13 - multilingual typo-tolerant search | Implemented | `958e9d0`, `7fb46eb`; maintained multilingual search documents/terms, aliases, deterministic ranking, tests, rollout notes, and a documented local 20k `EXPLAIN ANALYZE`. | Verify extension permissions and migration/query behavior on a production-sized clone/provider. |

Cross-stage follow-ups are also committed: exact money contracts, durable payment and
storage recovery, session-epoch enforcement, bounded authenticated lists, and one
central order-transition service.

## Release-blocking closeout

1. Finish and commit the API-contract closeout. At `42f3ddc`, the full shared
   Product/Order/Message/DisputeMessage/Seller contract objective was still partial.
2. Confirm `git status --short` is clean and record the final branch SHA and complete
   `origin/main..HEAD` commit list.
3. Run the final backend lint/build/full-test suite.
4. Run clean-database migration up, schema contracts, repeated release migration/no-op,
   and relevant down/rollback checks.
5. Run frontend typecheck, i18n validation, unit tests, and production build.
6. Validate production, development, and E2E Compose models and build the production
   images.
7. Run the isolated Playwright suite.
8. Run the audit-policy tests/audits and full-history Gitleaks scan.
9. Replace every `NOT RUN` entry in `docs/final-hardening-report.md` with the exact
   command, status, and test count. Do not infer CI success from local success.

## Residual risks after closeout

- Production PostgreSQL must permit `pg_trgm` and `unaccent`; otherwise the search
  release must stop before application rollout.
- Search backfill uses bounded statements but the release runner uses one transaction.
  Measure locks, duration, data distribution, and query latency on production-scale data.
- The high-advisory exceptions in `docs/security/npm-audit-debt.md` expire on
  2026-08-21 and include Next.js, Sharp, and build-tool dependencies.
- Uploaded content is magic-byte validated but not malware scanned.
- Real payment, email, SMS, Telegram, and S3 provider behavior remains outside
  automated validation.
- Multi-replica API deployment requires S3-compatible storage; a local volume is not
  shared across hosts.
- Read replicas and production capacity/load validation remain out of scope.

## Ongoing constraints

- Do not integrate or call real payment providers. Automated tests use only the
  explicitly gated mock flow.
- Run migrations through the release job, never API/worker/outbox startup.
- Do not claim a check passed unless its command completed successfully on the stated
  tree.
