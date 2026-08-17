# Remaining nonfinancial hardening plan

This tracker aligns the repository with Master Hardening Plan V2 as captured on
2026-08-17. It is not a production-readiness certificate. The canonical strict
stage order is recorded in
[`nonfinancial-execution-plan.md`](nonfinancial-execution-plan.md).

## Execution snapshot

| Fact | Captured value | Meaning |
| --- | --- | --- |
| Capture date | `2026-08-17` | Date of the Stage 3 documentation alignment. |
| Recorded V2 baseline | `805163058855fde32b3a1474b75169ceaaa95ade` | Application tree validated during Stage 1. |
| Stage 3 input `main` | `844a865b6c79ab53760416c3e2d021034625d91c` | Current local HEAD before this documentation change. |
| Stage 3 input `origin/main` | `844a865b6c79ab53760416c3e2d021034625d91c` | Current remote-tracking main before this documentation change. |
| Input branch divergence | `0 0` | No commits were unique to local or remote main. |
| Input working tree | Clean | `git status --short` returned no entries. |
| Latest exact-SHA CI | [run 32014884140](https://github.com/spacour1/skrynia-2.0/actions/runs/32014884140) | PASS, 10/10 jobs for `844a865`, including `financial-freeze`. |
| Production readiness | **NOT CERTIFIED** | Staging, provider, recovery, performance, and final release evidence remain incomplete. |

The clean-tree and SHA statements describe the input to this Stage 3 edit. The
documentation commit has a later SHA and requires its own green CI before Stage
3 closes.

## Evidence ledger

Evidence remains attributable to the tree on which it was collected:

| Checkpoint | Evidence | Classification |
| --- | --- | --- |
| `364547c` | [CI 30697861790](https://github.com/spacour1/skrynia-2.0/actions/runs/30697861790), PASS 9/9 | Historical snapshot of the superseded 2026-08-01 plan. |
| `8051630` | Local backend 57 files / 540 tests and frontend 19 files / 145 tests; [CI 31525717518](https://github.com/spacour1/skrynia-2.0/actions/runs/31525717518), PASS 9/9 including E2E 9/9 | Stage 1 application evidence. |
| `f86ebef` | [CI 32003940348](https://github.com/spacour1/skrynia-2.0/actions/runs/32003940348), PASS 9/9 | Stage 1 baseline-document commit. |
| `844a865` | Financial-freeze policy tests 45/45; [CI 32014884140](https://github.com/spacour1/skrynia-2.0/actions/runs/32014884140), PASS 10/10 | Stage 2 guard and current exact-SHA CI evidence. |

Local and CI evidence is not staging or real-provider evidence. Production-like
staging, rollback, multi-replica behavior, and real email, SMS, Telegram,
S3/object-storage, and Sentry delivery remain **NOT RUN**. Financial provider
validation is outside the explicitly frozen nonfinancial scope.

## Completed foundations removed from TODO

These completed items remain historical prerequisites and are not active work:

| Item | Evidence |
| --- | --- |
| Graphify project installation | `a7553a2` |
| Graphify local pilot | `23f5b28` |
| Bounded audit shutdown drain | `650a973` |
| Post-commit participant cache invalidation | `d47985a` (financial implementation is now frozen) |
| Cross-tab refresh coordination and fallback | `012bb99`, fixture alignment `e3a4806` |
| Explicit offline logout recovery | `c068219` |
| Sharp/libvips remediation | `555cb6f` |
| Supported patched Next.js runtime | `8051630` |
| Refreshed nonfinancial baseline | `f86ebef` |
| Financial subsystem freeze guard | `844a865` |

Completed groundwork does not close later validation stages. Basic WebSocket,
outbox, search, Docker, E2E, and Graphify functionality still require their
explicit V2 validation or final-gate evidence.

## Current V2 status

| Stage | Status | Boundary |
| --- | --- | --- |
| 1 - refresh hardening baseline | **DONE** | `f86ebef`; CI 32003940348, PASS 9/9. |
| 2 - financial freeze guard | **DONE** | `844a865`; CI 32014884140, PASS 10/10. |
| 3 - align hardening documentation | **IN PROGRESS** | This documentation set; closes after its separate commit, push, SHA verification, and green CI. |
| 4 - step-up authentication | **NEXT / TODO** | First implementation stage after Stage 3 closes. |
| 5-63 | **TODO** | Must remain in the strict order in the canonical execution plan. |

## Current queue

| Queue item | V2 stage(s) | Status |
| --- | --- | --- |
| Financial freeze guard | 2 | **DONE** |
| Account identity security | 4-10 | TODO |
| Step-up authentication | 4 | TODO |
| Secure email change | 5 | TODO |
| Verification-token binding | 6 | TODO |
| Atomic security tokens | 7 | TODO |
| Password-reset generations | 8 | TODO |
| Unified password policy | 9 | TODO |
| Login timing hardening | 10 | TODO |
| Production environment fail-fast | 11-12 | TODO |
| Sentry/toolchain remediation | 13 | TODO |
| TOTP hardening | 14-16 | TODO |
| Private storage boundary | 17-18 | TODO |
| WebSocket validation | 19-20 | TODO |
| Outbox validation | 21 | TODO |
| Search pagination | 22 | TODO |
| Search performance | 23 | TODO |
| Moderation and cache | 24-25 | TODO |
| Frontend security headers and CSP | 26-27 | TODO |
| Dedicated nonfinancial E2E | 28 | TODO |
| Disaster recovery | 29-33 | TODO |
| Failure injection and shutdown | 34-38 | TODO |
| Multi-replica staging | 39 | TODO |
| Performance baseline and load test | 40-41 | TODO |
| KeepGame naming | 42 | TODO |
| ast-grep | 43 | TODO |
| dependency-cruiser | 44 | TODO |
| verify-changed | 45 | TODO |
| Real lint/typecheck/build separation | 46 | TODO |
| Lefthook | 47 | TODO |
| Knip | 48 | TODO |
| Renovate | 49 | TODO |
| Docker Buildx/GHA cache | 50 | TODO |
| Graphify final evaluation | 51 | TODO |
| Serena/Semble A/B | 52 | TODO |
| MCP budget | 53 | TODO |
| Final D5 gates and branch protection | 54-61 | TODO |
| Final restore drill | 62 | TODO |
| Final hardening report | 63 | TODO |

## Residual risks

- The financial subsystem is intentionally frozen. The guard is a reviewed,
  fail-closed repository policy, not proof that every future semantic financial
  boundary is automatically discoverable. Coverage remains subject to CI and
  review.
- The frontend retains the exact temporary Rollup advisory exception
  `GHSA-mw96-cpmx-2vgc`, expiring 2026-08-21; Stage 13 owns its removal.
- Step-up identity confirmation, email/token lifecycles, password generations,
  unified password policy, login timing, TOTP replay handling, and backup-code
  lifecycle work remain open.
- Private attachment authorization, durable multi-replica realtime behavior,
  outbox recovery, deterministic pagination, moderation/cache consistency, and
  browser CSP evidence remain open.
- Production PostgreSQL extension permissions, backup/restore, object-storage
  recovery, Redis recovery, secret recovery, failure injection, load behavior,
  and rollback remain unverified.
- Real external-provider behavior remains **NOT RUN**; mocks and CI are not
  provider evidence.

## Ongoing constraints

- Do not modify the frozen payment, wallet, ledger, escrow, settlement, payout,
  refund, fee, currency, money, or other financial lifecycle implementation.
- If a nonfinancial stage requires such a change, stop that change and record it
  in [`deferred-financial-scope.md`](deferred-financial-scope.md).
- Run the financial-freeze guard, the stage-appropriate risk gate, and
  `git diff --check` before every commit.
- Commit and push one stage at a time directly to `main` under the user's
  explicit workflow, never force-push, and wait for green exact-SHA CI before
  starting the next stage.
- Do not claim production readiness until Stage 63 reconciles every required
  local, CI, staging, provider, recovery, and performance result.
