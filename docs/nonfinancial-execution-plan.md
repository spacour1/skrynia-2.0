# Nonfinancial execution plan

This is the canonical repository status ledger for Master Hardening Plan V2.
It records the strict sequential order for the nonfinancial program and the
capture-time status at the Stage 3 input SHA.

## Execution checkpoint

| Fact | Value |
| --- | --- |
| Capture date | `2026-08-17` |
| Active branch | `main` |
| Stage 3 input local and remote SHA | `844a865b6c79ab53760416c3e2d021034625d91c` |
| Input divergence | 0 ahead / 0 behind |
| Input worktree | Clean |
| Stage 1 | DONE - `f86ebef`, CI 32003940348 PASS 9/9 |
| Stage 2 | DONE - `844a865`, CI 32014884140 PASS 10/10 |
| Stage 3 | IN PROGRESS - this documentation alignment |
| Next implementation stage | 4 - Step-Up Authentication |
| Production readiness | **NOT CERTIFIED** |

## Scope boundary

The financial subsystem is frozen by explicit user instruction. Financial
implementation may be read to verify dependency boundaries but must not be
changed. A nonfinancial stage that cannot proceed without a financial change
must stop that part and record it in
[`deferred-financial-scope.md`](deferred-financial-scope.md).

Previously completed Graphify installation/pilot, audit drain, cross-tab refresh,
offline logout, Sharp/libvips remediation, and Next.js remediation are historical
foundations, not TODO work. Existing basic WebSocket, outbox, search, and E2E
coverage does not close their later validation stages.

## Canonical stage ledger

Statuses are capture-time facts. Stages must run in numeric order; a later stage
does not start until the preceding stage has its own commit on `main` and green
CI for that exact SHA.

| Phase | Stage | Work item | Status at capture |
| --- | ---: | --- | --- |
| A | 1 | Refresh hardening baseline | DONE |
| A | 2 | Financial freeze guard | DONE |
| A | 3 | Update stale hardening documents | IN PROGRESS |
| B | 4 | Step-Up Authentication | TODO |
| B | 5 | Secure pending-email workflow | TODO |
| B | 6 | Email-verification token binding | TODO |
| B | 7 | Atomic security-token consumption | TODO |
| B | 8 | Password-reset generations | TODO |
| B | 9 | Unified password policy | TODO |
| B | 10 | Login timing hardening | TODO |
| C | 11 | Production environment fail-fast | TODO |
| C | 12 | Frontend environment validation | TODO |
| D | 13 | Sentry/Rollup/toolchain remediation | TODO |
| E | 14 | Timing-safe TOTP comparison | TODO |
| E | 15 | TOTP replay protection | TODO |
| E | 16 | Full 2FA lifecycle | TODO |
| F | 17 | Public/private media boundary and private chat-attachment authorization | TODO |
| F | 18 | Storage failure/durability validation | TODO |
| G | 19 | WebSocket security validation | TODO |
| G | 20 | Multi-replica WebSocket validation | TODO |
| H | 21 | Outbox validation | TODO |
| I | 22 | Deterministic cursor pagination | TODO |
| I | 23 | Search/index performance | TODO |
| J | 24 | Moderation visibility matrix | TODO |
| J | 25 | Cache invalidation | TODO |
| K | 26 | Frontend security headers | TODO |
| K | 27 | Content Security Policy | TODO |
| L | 28 | Dedicated nonfinancial E2E | TODO |
| M | 29 | Disaster-recovery document | TODO |
| M | 30 | PostgreSQL backup/restore | TODO |
| M | 31 | Object-storage recovery | TODO |
| M | 32 | Redis recovery policy | TODO |
| M | 33 | Security-secret recovery | TODO |
| N | 34 | PostgreSQL failure injection | TODO |
| N | 35 | Redis failure injection | TODO |
| N | 36 | Storage failure injection | TODO |
| N | 37 | Worker crash recovery | TODO |
| N | 38 | SIGTERM/graceful shutdown | TODO |
| O | 39 | Multi-replica staging | TODO |
| P | 40 | Performance baseline | TODO |
| P | 41 | Load testing | TODO |
| Q | 42 | KeepGame user-facing naming | TODO |
| R | 43 | ast-grep architecture guard | TODO |
| R | 44 | dependency-cruiser | TODO |
| R | 45 | verify-changed | TODO |
| S | 46 | Real lint/typecheck/build separation | TODO |
| S | 47 | Lefthook | TODO |
| S | 48 | Knip | TODO |
| S | 49 | Renovate | TODO |
| S | 50 | Docker Buildx/GitHub Actions cache | TODO |
| T | 51 | Graphify final review | TODO |
| T | 52 | Serena versus Semble A/B | TODO |
| T | 53 | MCP budget | TODO |
| U | 54 | Backend full gate | TODO |
| U | 55 | Frontend full gate | TODO |
| U | 56 | Nonfinancial E2E full gate | TODO |
| U | 57 | Database full gate | TODO |
| U | 58 | Docker full gate | TODO |
| U | 59 | Security full gate | TODO |
| U | 60 | GitHub Actions full gate | TODO |
| U | 61 | Branch protection | TODO |
| V | 62 | Final restore drill | TODO |
| W | 63 | Final hardening report | TODO |

## Per-stage verification and publication protocol

For every stage:

1. Verify current `main`, `origin/main`, divergence, and worktree scope.
2. Understand the current implementation and make only the minimal stage change.
3. Add observable regression tests when behavior changes.
4. Run targeted tests and the package/risk gate required by `AGENTS.md`.
5. Run `node --test scripts/check-financial-freeze.test.mjs` when the guard itself changes.
6. Run `node scripts/check-financial-freeze.mjs --base origin/main` and require PASS.
7. Run `git diff --check`, review the complete staged diff, and verify no secrets or unrelated files.
8. Create the exact logical stage commit and push it directly to `origin/main`
   under the user's explicit direct-main workflow; never force-push.
9. Verify local, remote-tracking, and remote branch SHAs are identical.
10. Wait for every GitHub Actions job for that exact SHA to finish successfully
    before starting the next stage.

Documentation-only stages use the D0 local gate, but their post-push CI still
provides the repository's complete automated backend, frontend, Docker, audit,
secret-scan, and E2E checks. Staging and real-provider checks remain separate
evidence and must never be inferred from CI.
