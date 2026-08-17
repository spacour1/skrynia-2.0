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

No deferred financial changes are recorded as of 2026-08-17.

Previously completed financial work removed from the superseded hardening queue
is historical, not an active deferred item. Add an item here only when a later
nonfinancial stage actually reaches a required frozen boundary.

## Entry format

For each deferred item, record:

- date and hardening stage;
- nonfinancial objective that exposed the dependency;
- exact financial path or lifecycle boundary that would need to change;
- why the nonfinancial-only alternative is insufficient;
- tests or evidence needed before the financial scope is deliberately reopened.
