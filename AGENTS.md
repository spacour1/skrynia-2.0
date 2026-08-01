# SKRYNIA 2.0 — Agent Rules

## Scope

These rules apply repository-wide. A nested `AGENTS.md` adds or narrows rules for
its directory tree; follow both, with the nearest file taking precedence.

KeepGame is a P2P digital marketplace with escrow. The stack is Node.js/Express
with TypeScript (ESM), Next.js 14 App Router, PostgreSQL, Redis, and BullMQ.

Start with `docs/agent-map.md`. Do not scan generated or dependency directories
(`node_modules`, `.next`, `dist`, `uploads`, coverage) unless the task requires it.
Do not read lockfiles unless dependency resolution is in scope.

## Global invariants

- Persist money as integer cents. Public money fields that may exceed JavaScript's
  safe range are decimal strings; use `bigint`, never floating-point arithmetic.
- The ledger is append-only and balanced per entry. Every wallet or escrow mutation
  and its ledger entry belong to the same database transaction.
- Change order status only through the canonical transition boundary. Any state
  machine change requires enum, matrix, schema, integration, and documentation checks.
- Payment callbacks remain idempotent. Preserve conflict-safe idempotency behavior.
- Keep provider/network calls out of financial database transactions. Cache,
  realtime, notification, and queue side effects happen only after commit.
- Every schema change requires a timestamped migration with a rollback note.

## Safety boundaries

- Never connect tools or tests to production databases, run production migrations,
  use production data, or execute destructive SQL against an unknown database.
- Never call real payment providers or use real provider credentials, charges, or
  refunds. Automated tests use only the explicitly gated test-payment flow; mocks
  are not evidence that a real provider works.
- Never expose secrets in output, diffs, commits, logs, Sentry, snapshots,
  documentation, or Graphify output. This includes database URLs, JWT/encryption
  keys, provider/webhook/Telegram/S3 credentials, tokens, cookies, passwords,
  backup codes, and TOTP secrets.

## Graph-assisted repository navigation

Graphify is a navigation aid, not a correctness oracle. Before broad searches:

1. Read `docs/agent-map.md`.
2. Read every `AGENTS.md` applicable to the target directory.
3. For cross-domain work, run a scoped Graphify query.
4. Reduce the result to no more than 10–15 candidate source files.
5. Verify every material dependency directly in those source files.

Use Graphify for callers/callees, dependency paths, blast radius,
route-to-service-to-database traces, DTO/contract paths, order/payment/auth flows,
and PR overlap. Do not require it for copy edits, known leaf components, simple
documentation fixes, or one known helper with no cross-domain effect.

- `EXTRACTED` is navigation evidence and still requires source verification.
- Inspect every participating file for `INFERRED`; use `AMBIGUOUS` only as a lead.
- Never load `graphify-out/graph.json` wholesale or treat an edge as proof.
- Graphify never replaces tests, authorization, ledger, migration, CI, or runtime review.
- After architectural changes, run `graphify update .`, rerun the relevant query,
  and report whether the dependency path changed.

## Task-specific direct-main workflow

For this hardening task, the user's direct-to-`main` workflow explicitly replaces
the repository's normal PR-only rule:

1. Work on an up-to-date local `main` with a clean, understood worktree.
2. Run the risk gate below and review the staged diff; commit one logical topic.
3. Fetch `origin` and compare `origin/main...main` before pushing.
4. If remote advanced, rebase onto `origin/main` and rerun the complete risk gate.
5. Only after PASS, run `git push origin main`, verify local/remote SHA equality,
   and check GitHub Actions for that SHA.

Never force-push, rewrite published `main`, discard unknown work with
`git reset --hard`, push an unverified commit, or continue past red CI without a
documented external blocker.

## Risk-based validation matrix

Choose the smallest sufficient gate; nested rules may require a stronger one.

| Level | Change | Required validation |
| --- | --- | --- |
| D0 | Documentation only | `git diff --check`; verify links, commands, paths, SHAs, and absence of secrets |
| D1 | Frontend leaf | `cd frontend`; `npm run typecheck`; affected Vitest tests; add `npm run i18n:check` for visible strings/translations |
| D2 | Frontend route/auth/config/provider | Frontend typecheck, i18n check, full tests, and build; auth/session/navigation also requires safe targeted or full E2E |
| D3 | Backend low-risk | `cd backend`; lint, affected Vitest tests, and build |
| D4 | Backend high-risk | Backend lint, build, and full tests |
| D5 | Release | Clean installs and all backend/frontend checks, Compose validation/build, E2E, dependency-audit policy, and full history secret scan |

D4 includes auth, sessions, 2FA, payments, orders, escrow, wallet, ledger,
disputes, storage ownership, outbox, WebSocket, shutdown, migrations, shared
contracts, and money. Migration changes additionally require two consecutive
`npm run migrate:deploy` runs against an isolated non-production database and
`npx vitest run test/schema-contract.test.ts`.

## Truthful evidence

- Write `PASS` only for a command that actually completed with exit code `0`.
- Use only `PASS`, `FAIL`, `BLOCKED`, or `NOT RUN` and record command, exit code,
  test count, duration when available, SHA, and environment.
- A workflow file is not green CI; a local build is not GitHub Actions; a unit
  test is not production behavior; a mock is not real-provider evidence; and a
  Graphify edge is not correctness proof.
