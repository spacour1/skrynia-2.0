# Current hardening baseline

This document captures the evidence available on 2026-08-01. It separates old
test records, current-tree local checks, CI, staging, and real-provider evidence
so that a result from one category is not presented as proof for another.

## Snapshot

| Item | Value |
| --- | --- |
| Evidence capture date | 2026-08-01 |
| Branch | `main` |
| Prompt-recorded prior SHA | `7043159` (`chore(security): document secret scan placeholder exception`) |
| Verified execution-start HEAD | `a7553a2` |
| Stage 3 baseline input / current pre-Stage-3 `main` | `364547c` |
| Local/remote parity | `main == origin/main == 364547c` |
| Working tree | Clean at evidence capture (`git status --short` returned no entries) |
| Production readiness | **Not certified** |

The prompt's prior reference, `7043159`, is retained as provenance. The HEAD
that was actually checked before this execution began was `a7553a2`; these are
different facts and must not be collapsed into one start SHA.

## Commits after the old closeout snapshot

The prior closeout snapshot ended at `dab02a8`. All 12 later commits present in
the Stage 3 input tree are recorded here in chronological order:

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

The prompt-recorded prior SHA is `7043159`; the verified execution-start HEAD is
`a7553a2`. The commits after `a7553a2` change documentation and agent instructions
only, so they do not provide a new local full-suite run on `364547c`.

## Historical evidence

Before the later hardening work, the recorded baseline at `36ea677` was:

| Command | Recorded result |
| --- | --- |
| `cd backend && npm ci` | PASS |
| `cd backend && npm run lint` | PASS |
| `cd backend && npm run build` | PASS |
| `cd backend && npm test` | PASS - 293/293 tests in 33 files (277.77s) |
| `cd frontend && npm ci` | PASS |
| `cd frontend && npm run typecheck` | PASS |
| `cd frontend && npm run i18n:check` | PASS - 0 errors, 25 baseline warnings |
| `cd frontend && npm test` | PASS - 6/6 legacy realtime-client tests |
| `cd frontend && npm run build` | PASS |
| Production and development Compose config | PASS |
| `docker compose build` | PASS |

These results are historical evidence for `36ea677` only. They are not current-
tree, staging, or production-provider evidence.

## Current-tree evidence

The following commands completed against `a7553a2` on Windows PowerShell with
Node.js 20.20.2 and isolated Docker PostgreSQL 16/Redis 7 services. Every PASS
below had exit code 0; durations are wall-clock measurements captured by the
local wrapper.

| Area | Exact command | Result |
| --- | --- | --- |
| Backend | `cd backend; npm run lint` | PASS - exit 0, 23.31s, test count not applicable |
| Backend | `cd backend; npm run build` | PASS - exit 0, 5.93s, test count not applicable |
| Backend | `cd backend; npm test` | PASS - exit 0, 55 files / 488 tests, 467.25s |
| Database | `cd backend; npm run migrate:deploy` against a fresh isolated `marketplace_test` database | PASS - exit 0, 40 SQL migrations, 2.77s |
| Database | second consecutive `cd backend; npm run migrate:deploy` | PASS - exit 0, 0 SQL migrations pending, 0.71s |
| Database | `cd backend; npx vitest run test/schema-contract.test.ts` | PASS - exit 0, 7 tests, 12.28s wrapper duration |
| Frontend | `cd frontend; npm run typecheck` | PASS - exit 0, 24.30s, test count not applicable |
| Frontend | `cd frontend; npm run i18n:check` | PASS - exit 0, 0 errors / 25 baseline warnings, 1.45s |
| Frontend | `cd frontend; npm test` | PASS - exit 0, 14 files / 62 tests, 54.45s wrapper duration |
| Frontend | `cd frontend; npm run build` | PASS - exit 0 on the completed rerun, 55.17s; the earlier wrapper attempt timed out and was not counted as PASS |

Because `23f5b28` and `364547c` are documentation/instruction-only changes, this
is relevant implementation evidence for the application code that remains in
the current tree. It is not an exact local full-suite rerun at `364547c`; that
rerun remains unrecorded.

The current local Graphify snapshot covers 535 files and contains 3,176 nodes,
8,571 edges, 13 hyperedges, and 179 named communities. Graph health reports 0
warnings. Generated Graphify outputs are ignored by Git and remain local
navigation evidence, not application-correctness or production-readiness proof.

## CI evidence

| Commit | GitHub Actions run | Required jobs | Result |
| --- | --- | --- | --- |
| `23f5b28` | [30697353208](https://github.com/spacour1/skrynia-2.0/actions/runs/30697353208) | 9/9 | PASS |
| `364547c` | [30697861790](https://github.com/spacour1/skrynia-2.0/actions/runs/30697861790) | 9/9 | PASS |

These green runs are CI evidence for their exact SHAs. They do not replace
staging, rollback, production-sized search, or real-provider validation.

## Staging evidence

| Check | Status |
| --- | --- |
| Production-like staging rollout, restart, and failure-path exercise | **NOT RUN** |
| Rollback and recovery rehearsal | **NOT RUN** |
| Production-target `pg_trgm`/`unaccent` permission verification | **NOT RUN** |
| Final multilingual search benchmark on a production-sized data clone | **NOT RUN** |

No staging result is promoted to PASS in this capture.

## Production-provider evidence

| Provider boundary | Status |
| --- | --- |
| Real payment provider | **NOT RUN** |
| Real email provider | **NOT RUN** |
| Real SMS provider | **NOT RUN** |
| Real Telegram integration | **NOT RUN** |
| Real S3/object-storage provider | **NOT RUN** |

Mocks, local services, and green CI jobs do not constitute real-provider
evidence.

## Current blockers and remaining work

Production readiness remains blocked by the uncompleted or unverified parts of
the closeout plan, notably:

- no exact local full-suite rerun is recorded for the `364547c` baseline input;
- staging deployment, failure recovery, rollback, and final search benchmarking
  remain `NOT RUN`;
- real payment, email, SMS, Telegram, and object-storage paths remain `NOT RUN`;
- audit-log draining and shutdown guarantees still require closeout work and
  verification;
- transaction boundaries, Redis/external calls, and cache-consistency paths
  still require hardening and validation;
- cross-tab refresh fallback and offline logout behavior remain to be closed;
- side-effecting GET flows still require durable command/intent semantics;
- provider verification/persistence separation and immutable payment reference,
  amount, and currency checks remain to be completed;
- TOTP and secret-handling hardening remains open;
- time-limited npm audit exceptions in `docs/security/npm-audit-debt.md` expire
  on 2026-08-21;
- production capacity and operational failure testing remain outstanding.

The repository must not be described as production-ready until the remaining
release gates have evidence and no unexplained `NOT RUN`, `FAIL`, or `BLOCKED`
result remains.
