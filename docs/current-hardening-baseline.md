# Current hardening baseline

This file distinguishes implementation evidence from final validation evidence. It
supersedes the stale statement that Stages 8-13 were missing.

## Snapshot

| Item | Value |
| --- | --- |
| Date | 2026-07-26 |
| Branch | `codex/finish-big-plan` |
| Base | `origin/main` at `36ea677` |
| Committed snapshot | `42f3ddc` (`fix(api): bound remaining authenticated lists`) |
| Final HEAD | **NOT RECORDED - update after current changes are committed** |
| Working tree | Dirty at documentation time; uncommitted code/E2E changes are excluded from committed evidence. |
| Production readiness | Not certified. |

## Implemented scope

Stages 0-7 remain represented by the base at `36ea677`: domain/schema
reconciliation, atomic registration, versioned session revocation, transaction retries,
resource-abuse controls, partial contract centralization, and order-state-machine
hardening.

The current branch adds:

| Stage | Status at committed snapshot | Evidence |
| --- | --- | --- |
| 8 - frontend test foundation | Implemented | `3697ea2` |
| 9 - frontend reliability | Implemented | `925af5d`, `567c052`, `da934c2`, `49db14e`, `0d9dd52`, `b398e60` |
| 10 - production runtime and operations | Implemented | `2746d42`, `26b619b`, `81972bb` |
| 11 - CI gates | Implemented in workflow | `0f1c225` |
| 12 - isolated Playwright E2E | Implemented | `d3db9a5`, plus `df87afb`, `c68aa21`, `419e095` |
| 13 - multilingual typo-tolerant search | Implemented | `958e9d0`, `7fb46eb` |

Cross-stage hardening on this branch also covers session epoch enforcement, order DTO
mapping, payment capture/webhook recovery, durable storage operation states, exact money
cents, bounded list pagination, trace propagation, and centralized lifecycle writes.

## Historical verification baseline

Before the later Stage 8-13 implementation, the recorded baseline at `36ea677` had:

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

These results establish the old base only. They must not be quoted as validation of
`42f3ddc` or the final tree.

## Final-tree verification

| Check | Status |
| --- | --- |
| Backend lint/build/full tests | **NOT RUN - final tree** |
| Clean/repeat migrations and schema contracts | **NOT RUN - final tree** |
| Frontend typecheck/i18n/tests/build | **NOT RUN - final tree** |
| Production/dev/E2E Compose config | **NOT RUN - final tree** |
| Production Docker builds | **NOT RUN - final tree** |
| Isolated Playwright suite | **NOT RUN - final tree** |
| Audit-policy checks and npm audits | **NOT RUN - final tree** |
| Full-history secret scan | **NOT RUN - final tree** |

Populate exact commands, statuses, durations, and test counts in
[`final-hardening-report.md`](final-hardening-report.md).

## Current blockers and limits

- The committed API-contract work is not the complete shared Product/Order/Message/
  DisputeMessage/Seller contract target. Do not mark it complete until the current
  contract closeout is committed and tested.
- CI jobs exist but no green final workflow run is recorded here.
- Production `pg_trgm`/`unaccent` permissions and production-sized search rollout
  behavior are unverified.
- Time-limited high-advisory exceptions remain in
  `docs/security/npm-audit-debt.md`; they expire on 2026-08-21.
- Real payment, email, SMS, Telegram, and S3 integrations are not validated by the
  automated suite.
- Upload malware scanning, read replicas, and production capacity validation remain
  outside this hardening branch.

Do not describe the application as production-ready until the final report has no
unexplained `NOT RUN`, `FAIL`, or `BLOCKED` release gate.
