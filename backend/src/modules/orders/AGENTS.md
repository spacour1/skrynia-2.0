# Orders module instructions

This file applies to `backend/src/modules/orders/`. Inherit the repository and
backend instructions. Treat every runtime change here as D4 high risk.

## Invariants

- `transitionOrder()` in `order-transition.service.ts` is the only production
  status writer for an existing order. Keep the matrix in `order-transitions.ts`,
  actor checks, timeline event, and durable outbox intent together.
- A state-machine change requires the canonical enum, transition matrix, schema
  contract, matrix tests, affected integration tests, and documentation to agree.
- Money stays in integer cents. Use `MoneyCents`/`bigint` helpers; never use
  floating-point arithmetic for persisted money.
- Every wallet or escrow mutation must book one balanced, idempotent ledger entry
  in the same database transaction. Ledger history is append-only.
- Financial transaction callbacks may contain PostgreSQL reads, locks, writes,
  ledger entries, timeline rows, persisted system messages, and outbox rows only.
  Never perform provider calls, Redis operations, email, Telegram, queue publish,
  S3, or another network call inside them.
- Invalidate order, order-list, and affected wallet caches only after commit.
  Invalidation is best-effort and must not turn a committed money mutation into a
  reported failure. Existing in-transaction cache/provider calls are debt, not a
  pattern to copy.
- Preserve concurrency and replay safety: row locks, canonical transitions,
  stable idempotency keys, and no duplicate ledger, timeline, or outbox records.
- Return orders through the mappers in `orders.dto.ts`; raw database rows and
  snake_case fields must not cross the HTTP boundary.

## Verification gates

Commands assume the repository root. Run targeted tests first:

```bash
cd backend
npx vitest run test/order-transitions.test.ts test/ledger.test.ts test/marketplace-cache-invalidation.test.ts test/domain-outbox.test.ts test/dto-contracts.test.ts
```

Then run the complete D4 backend gate:

```bash
cd backend
npm run lint
npm run build
npm test
```

For order, escrow, ledger, or cache behavior changes, also run the critical E2E flow:

```bash
node e2e/scripts/run.mjs
```

If the schema changes, use only an isolated non-production test database and run:

```bash
cd backend
npm run migrate:deploy
npm run migrate:deploy
npx vitest run test/schema-contract.test.ts
```
