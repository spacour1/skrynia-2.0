# Current hardening baseline

This file distinguishes implementation evidence from final validation evidence. It
supersedes the stale statement that Stages 8-13 were missing.

## Snapshot

| Item | Value |
| --- | --- |
| Date | 2026-07-31 |
| Branch | `codex/final-hardening-closeout`, created from the current `main` |
| Base | `origin/main` at `dab02a8` |
| Committed snapshot | `dab02a8` (`finish production hardening and shared contracts`) |
| Final HEAD | `dab02a8` at closeout start; replace with the final branch SHA after validation commits. |
| Working tree | Clean at closeout start (`git status --short`, exit code 0). |
| Production readiness | Not certified. |

## Closeout reconciliation

| Item | Current fact | Documented fact before reconciliation | Drift | Required update |
| --- | --- | --- | --- | --- |
| Commit | `main` and `origin/main` point to `dab02a8`. | The latest recorded snapshot was `42f3ddc`; final HEAD was not recorded. | Yes | Use `dab02a8` as the closeout baseline and record the final branch SHA after validation. |
| Branch | Closeout work starts on `codex/final-hardening-closeout`. | The snapshot named `codex/finish-big-plan`. | Yes | Refer to the current closeout branch while retaining historical commit evidence. |
| Working tree | Clean before the closeout branch was created. | The tree was described as dirty with uncommitted contract work. | Yes | Treat the committed `dab02a8` tree as the implementation under validation. |
| API-contract closeout | Shared contracts, backend DTO mappers, frontend mirror, and synchronization tests are committed in `dab02a8`. | The closeout was described as partial and uncommitted. | Yes | Review the boundaries and run the targeted/full suites before marking the closeout verified. |
| Final validation | No final-tree gate has been rerun during this closeout yet. | All final-tree gates were `NOT RUN`. | No | Preserve `NOT RUN` until each exact command exits successfully. |

## Implemented scope

Stages 0-7 remain represented by the base at `36ea677`: domain/schema
reconciliation, atomic registration, versioned session revocation, transaction retries,
resource-abuse controls, partial contract centralization, and order-state-machine
hardening.

The history from `36ea677` through the current `main` adds:

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
Commit `dab02a8` additionally commits the shared Product, Order, Message, Dispute, and
Seller contracts, backend DTO mappers, the synchronized frontend mirror, and their
contract tests. Those changes are implementation evidence; Phase B validation remains
required before they are recorded as verified.

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

- The API-contract closeout is committed in `dab02a8`, but its DTO boundaries and
  synchronization tests still require the Phase B review and final-tree rerun before it
  can be marked verified.
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
