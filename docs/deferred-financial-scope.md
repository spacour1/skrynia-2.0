# Deferred financial scope

The payment, wallet, ledger, escrow, settlement, payout, refund, fee, currency,
money, and related financial lifecycle implementation is frozen by explicit user
instruction.

Nonfinancial work may read these areas to understand dependencies, but must not
change them. If a nonfinancial fix cannot be completed without a financial change,
stop that fix and record it here instead of bypassing the freeze.

## Enforcement checkpoint

The freeze is enforced from commit
`844a865b6c79ab53760416c3e2d021034625d91c` by:

- the repository policy in `AGENTS.md`;
- `config/financial-freeze.json`;
- `scripts/check-financial-freeze.mjs`;
- 45/45 policy tests in `scripts/check-financial-freeze.test.mjs`;
- the `financial-freeze` GitHub Actions job, green in
  [CI run 32014884140](https://github.com/spacour1/skrynia-2.0/actions/runs/32014884140).

The guard is fail-closed for its configured paths, symbols, fragments, content
signals, lifecycle changes, and unknown bases. It complements review and CI; it
is not a claim that arbitrary future financial semantics can be identified
without maintaining the policy.

## Deferred items

### 2026-09-08 — Stage 7: moderator access to overview revenue

- Objective: make the user/moderator/administrator visibility matrix explicit and
  enforce least privilege.
- Frozen boundary: `GET /admin/overview` in
  `backend/src/modules/admin/admin-users.routes.ts` includes platform-wallet revenue;
  the shared `/admin` gate currently also admits moderators.
- Why deferred: changing the authorization or response around this aggregate would
  modify a route whose contract includes frozen platform revenue. Hiding only the UI
  would leave the API exposure intact.
- Reopen evidence: explicit moderator-denied and administrator-allowed integration
  tests, review of the response DTO, the financial-freeze gate, and the complete D4
  backend gate.

### 2026-09-08 — Stage 7: price and discount marketplace keysets

- Objective: replace offset pagination with deterministic keyset traversal for every
  marketplace sort mode.
- Frozen boundary: price and discount ordering in
  `backend/src/modules/marketplace/marketplace-browse.routes.ts` depends on
  `price_cents`, `old_price_cents`, and the derived discount order.
- Why deferred: a correct resume token and SQL predicate must carry and compare money
  sort values. Reusing a created-at cursor would change the requested order, while
  altering those money comparisons is forbidden during the freeze. These paths remain
  bounded but are not converted to keysets in Stage 7.
- Reopen evidence: tied-price/tied-discount traversal tests with no gaps or duplicates,
  integer-cent edge cases, query-plan evidence on the synthetic marketplace dataset,
  and the complete financial/release gates.

### 2026-09-08 — Stage 7: sub-millisecond financial cursors

- Objective: preserve PostgreSQL timestamp precision in every keyset cursor.
- Frozen boundary: financial cursor callers in
  `backend/src/modules/orders/orders.routes.ts`,
  `backend/src/modules/admin/admin-finance.routes.ts`,
  `backend/src/modules/admin/admin-payouts.routes.ts`,
  `backend/src/modules/disputes/disputes.routes.ts`, and
  `backend/src/modules/disputes/dispute-messages.service.ts` currently build cursors
  from `pg` `Date` values, which truncate PostgreSQL microseconds.
- Why deferred: fixing each caller requires changing frozen order, transaction,
  payout, or dispute query projections and cursor construction. A shared helper cannot
  reconstruct precision after the driver has converted the value to `Date`.
- Reopen evidence: `.000900`/`.000800` fixtures for every affected list, complete
  no-gap/no-duplicate traversal, private cursor-field serialization checks, and all
  D4 plus financial invariant tests.

## Entry format

For each deferred item, record:

- date and hardening stage;
- nonfinancial objective that exposed the dependency;
- exact financial path or lifecycle boundary that would need to change;
- why the nonfinancial-only alternative is insufficient;
- tests or evidence needed before the financial scope is deliberately reopened.
