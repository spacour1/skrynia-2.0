# Disputes module rules

These rules extend the repository and backend instructions for
`backend/src/modules/disputes/**`.

## Invariants

- Treat every dispute change as D4 high risk: it crosses authorization, order state,
  escrow, ledger, audit, and realtime boundaries.
- Keep participant, moderator, and admin permissions explicit. Do not broaden
  `requireRole()` or participant visibility as a convenience.
- Move order status only through the canonical order transition service. Never update
  `orders.status` directly.
- Preserve resolution idempotency and the claim/execute/finalize operation boundary.
  Retries must not release or refund escrow twice.
- Escrow release or refund must preserve the append-only, balanced ledger invariants.
- Do not put provider/network calls or Redis cache operations inside financial database
  transactions. Invalidate participant/admin order caches only after commit.
- Store user-authored reasons and messages as data; never interpolate them into logs,
  SQL, or translated system-message keys.
- Map database rows to the appropriate participant, moderator, or admin DTO before the
  HTTP boundary.

## Verification gate

Run the D4 backend gate from the root instructions, plus:

```powershell
cd backend
npx vitest run test/dispute-consistency.test.ts test/dispute-moderator-permissions.test.ts
```

For affected end-to-end dispute behavior, run `e2e/tests/dispute.spec.ts` through the
repository E2E runner. A mocked escrow/provider test is not evidence of real-provider
behavior.
