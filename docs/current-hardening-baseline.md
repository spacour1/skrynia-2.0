# Current hardening baseline

This document captures the nonfinancial hardening evidence available on
2026-08-17. It keeps local, CI, staging, and real-provider evidence separate;
none of those categories is a substitute for another.

## Snapshot

| Item | Value |
| --- | --- |
| Evidence capture date | 2026-08-17 |
| Branch | `main` |
| Master Hardening Plan V2 recorded baseline | `805163058855fde32b3a1474b75169ceaaa95ade` |
| Verified Stage 1 input / pre-documentation HEAD | `805163058855fde32b3a1474b75169ceaaa95ade` |
| Remote main at execution start | `805163058855fde32b3a1474b75169ceaaa95ade` |
| Local/remote divergence | 0 ahead / 0 behind |
| Working tree at execution start | Clean (`git status --short` returned no entries) |
| Local tools | Node.js `24.18.0`; npm `11.16.0`; Docker client/server `29.5.3` |
| CI/runtime Node line | Node.js 20; production images use `node:20-alpine` |
| Production readiness | **NOT CERTIFIED** |

`8051630` is the input SHA whose application tree was validated. This document
will be committed at a later SHA; the two values must not be presented as the
same checkpoint.

## Changes since the previous baseline document

The previous baseline stopped at `364547c`. These later commits are part of the
current Stage 1 input, in chronological order:

| Commit | Change |
| --- | --- |
| `43cd59a` | `docs(hardening): align execution baseline with current main` |
| `650a973` | `fix(ops): drain pending audit writes before database shutdown` |
| `d47985a` | `refactor(orders): centralize post-commit participant cache invalidation` |
| `130cc52` | `fix(security): patch transitive dependency advisories` |
| `012bb99` | `fix(auth): coordinate refresh rotation without Web Locks` |
| `e3a4806` | `test(auth): align lease fixtures with monotonic clock` |
| `c068219` | `fix(auth): make offline logout behavior explicit` |
| `555cb6f` | `fix(security): upgrade image processing dependencies` |
| `8051630` | `fix(security): upgrade Next.js runtime` |

The application now includes the bounded audit drain, post-commit participant
cache invalidation, Web-Lock and fallback cross-tab refresh coordination,
offline logout recovery, Sharp/libvips remediation, and the supported Next.js
15 runtime upgrade. Those completed changes are not reopened without a new,
reproducible defect.

## Historical evidence

The local suite and Graphify measurements previously recorded for `a7553a2`
remain historical evidence for that SHA only. Subsequent application and
dependency changes mean those test counts and graph statistics are not current-
tree evidence and are intentionally not relabelled as such.

The CI history since the previous baseline is retained, including red runs and
their later fixes:

| Commit | GitHub Actions run | Result |
| --- | --- | --- |
| `43cd59a` | [30698893213](https://github.com/spacour1/skrynia-2.0/actions/runs/30698893213) | PASS - 9/9 jobs |
| `650a973` | [30701279467](https://github.com/spacour1/skrynia-2.0/actions/runs/30701279467) | PASS - 9/9 jobs |
| `d47985a` | [31338684075](https://github.com/spacour1/skrynia-2.0/actions/runs/31338684075) | FAIL - backend and frontend dependency-audit jobs |
| `130cc52` | [31340099094](https://github.com/spacour1/skrynia-2.0/actions/runs/31340099094) | PASS - 9/9 jobs |
| `012bb99` | [31343311963](https://github.com/spacour1/skrynia-2.0/actions/runs/31343311963) | FAIL - frontend unit-test job |
| `e3a4806` | [31343893915](https://github.com/spacour1/skrynia-2.0/actions/runs/31343893915) | PASS - 9/9 jobs |
| `c068219` | [31517847706](https://github.com/spacour1/skrynia-2.0/actions/runs/31517847706) | PASS - 9/9 jobs |
| `555cb6f` | [31521299384](https://github.com/spacour1/skrynia-2.0/actions/runs/31521299384) | PASS - 9/9 jobs |
| `8051630` | [31525717518](https://github.com/spacour1/skrynia-2.0/actions/runs/31525717518) | PASS - 9/9 jobs |

Red runs are not hidden. `130cc52` repaired the audit failure, and `e3a4806`
repaired the frontend lease fixture. The final Stage 1 input run is green.

## Exact current-tree local evidence

All commands below ran on 2026-08-17 against the `8051630` application tree on
Windows PowerShell. PostgreSQL 16 and Redis 7 ran in an isolated Compose project;
the containers, network, and dedicated PostgreSQL volume were removed after the
gate. No production service, provider, credential, or data was used.

| Area | Exact command | Result |
| --- | --- | --- |
| Backend install | `cd backend; npm ci` | PASS - exit 0; 400 packages installed; install/lint/build chain 69.9s total |
| Backend lint/typecheck | `cd backend; npm run lint` | PASS - exit 0 |
| Backend build | `cd backend; npm run build` | PASS - exit 0 |
| Database | `cd backend; npm run migrate:deploy` against a new isolated `marketplace_test` database | PASS - exit 0; 40 SQL migrations |
| Database repeatability | second consecutive `cd backend; npm run migrate:deploy` | PASS - exit 0; 0 SQL migrations pending |
| Backend tests | `cd backend; npm test -- --reporter=verbose` | PASS - exit 0; 57 files / 540 tests; Vitest 499.49s, wall 501.8s |
| Frontend install | `cd frontend; npm ci` | PASS - exit 0; part of the 159.5s frontend gate |
| Frontend typecheck | `cd frontend; npm run typecheck` | PASS - exit 0 |
| Frontend i18n | `cd frontend; npm run i18n:check` | PASS - exit 0; 0 errors / 25 pre-existing warnings |
| Frontend tests | `cd frontend; npm test` | PASS - exit 0; 19 files / 145 tests; 33.17s |
| Frontend build | `cd frontend; npm run build` | PASS - exit 0; Next.js 15.5.23; 96 static pages generated |
| Compose production | `docker compose --profile '*' config --quiet` | PASS - exit 0 |
| Compose development | `docker compose -f docker-compose.dev.yml config --quiet` | PASS - exit 0 |
| Compose E2E | `docker compose -f docker-compose.e2e.yml config --quiet` | PASS - exit 0 |
| Production images | `docker compose --profile '*' build` | PASS - exit 0; backend, migrate, worker, outbox, and frontend image targets; 134.6s |
| Backend dependency policy | `node .github/scripts/check-npm-audit.mjs backend` | PASS - exit 0; 1 low / 19 moderate / 0 high / 0 critical |
| Frontend dependency policy | `node .github/scripts/check-npm-audit.mjs frontend` | PASS - exit 0; 0 low / 24 moderate / 2 high / 0 critical; one exact allowed Rollup advisory |
| E2E dependency policy | `node .github/scripts/check-npm-audit.mjs e2e` | PASS - exit 0; no findings |

The first backend test attempt used a 10-minute command timeout and was recorded
as `TIMEOUT`, not PASS. Inspection showed active Vitest and PostgreSQL work rather
than a deadlock. The unchanged full suite was rerun with a sufficient limit and
completed 540/540; the successful rerun is the result reported above.

## Current CI evidence

GitHub Actions run [31525717518](https://github.com/spacour1/skrynia-2.0/actions/runs/31525717518)
is the exact CI result for `8051630`: **PASS, 9/9 jobs**.

| Job/evidence | Result |
| --- | --- |
| Backend build, clean migrations, repeat migrations, schema contract, full tests | PASS - 40 then 0 migrations; schema 7/7; 57 files / 540 tests |
| Frontend install, typecheck, i18n, tests, production build | PASS - 19 files / 145 tests; Next.js build green |
| Isolated Chromium E2E | PASS - 9/9 tests |
| Backend/frontend/E2E dependency-audit policy | PASS |
| Audit-policy unit suite | PASS - 10/10 tests |
| Full-history Gitleaks scan | PASS |
| Compose validation and production image build | PASS |

This is CI evidence for `8051630`. The documentation commit created from this
capture requires its own green CI run before Stage 1 is closed.

## Dependency security baseline

The current audit policy is fail-closed and passes for all three npm projects.
There are no backend or E2E high/critical exceptions. Frontend retains one exact
temporary exception:

- `rollup` / `GHSA-mw96-cpmx-2vgc`, maximum severity `high`, expires
  2026-08-21, owned by the Sentry/toolchain remediation stage.

The two frontend high package nodes are the aggregate `@sentry/nextjs` node and
the same concrete Rollup advisory, not two separately accepted GHSAs. Moderate
findings in Sentry/OpenTelemetry, DOMPurify, PostCSS, and UUID remain visible in
the audit output and are not described as resolved.

## Staging evidence

| Check | Status |
| --- | --- |
| Production-like staging rollout, restart, and failure-path exercise | **NOT RUN** |
| Rollback and recovery rehearsal | **NOT RUN** |
| Multi-replica production-like validation | **NOT RUN** |
| Final multilingual search benchmark on production-sized synthetic data | **NOT RUN** |

No local Docker or CI result is promoted to staging evidence.

## Production-provider evidence

| Provider boundary | Status |
| --- | --- |
| Real payment provider | **NOT RUN** |
| Real email provider | **NOT RUN** |
| Real SMS provider | **NOT RUN** |
| Real Telegram integration | **NOT RUN** |
| Real S3/object-storage provider | **NOT RUN** |
| Real Sentry event/source-map upload | **NOT RUN** |

Mocks, local services, and green CI jobs do not constitute real-provider
evidence. Financial-provider validation is also outside the current frozen
nonfinancial scope.

## Current blockers and remaining work

Production readiness remains **NOT CERTIFIED**. The principal open work is:

- the financial subsystem is frozen by explicit instruction, but the automated
  path/symbol freeze guard is not yet installed;
- step-up authentication and the pending email-change workflow are not yet
  implemented;
- verification/reset token binding, atomic consumption, password generations,
  unified password policy, and login timing hardening remain open;
- production backend and frontend configuration still require fail-fast
  validation;
- the expiring Rollup/Sentry exception and observability sanitization remain
  open;
- TOTP replay/timing and the full backup-code lifecycle require validation;
- private attachment authorization, multi-replica WebSocket behaviour, outbox
  recovery, deterministic pagination, moderation visibility/cache consistency,
  and browser security headers remain open;
- dedicated nonfinancial E2E, disaster recovery, failure injection,
  multi-replica staging, load evidence, and the final restore drill remain open;
- real staging, rollback, and nonfinancial provider boundaries remain `NOT RUN`.

The repository must not be described as nonfinancial production-ready until the
remaining stages and final release gates have recorded evidence and remaining
P0 risk is zero.
