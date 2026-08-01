# Payments module instructions

This file applies to `backend/src/modules/payments/`. Inherit the repository and
backend instructions. Treat every runtime change here as D4 high risk.

## Invariants

- Never use real provider credentials or make real charges/refunds in development,
  tests, or AI-assisted work. Test payments must stay behind the existing explicit
  test gate; a mock proves only internal persistence behavior.
- Treat every callback body as untrusted. Verify a signature or re-fetch the
  authoritative provider status, then verify order reference, provider reference,
  success state, exact amount, and currency before persistence.
- Keep provider verification and network I/O outside database transactions. Pass a
  canonical confirmed-payment value into a persistence boundary that owns the order
  lock, idempotency check, status transition, wallet/escrow mutation, balanced ledger,
  timeline, outbox, and immutable provider reference.
- A transaction callback must never call `provider.capture()`, HTTP, Redis, email,
  Telegram, S3, or another external service. Existing violations are debt, not a
  pattern to extend.
- Callback replay and concurrency must not duplicate payment records, ledger entries,
  order transitions, or outbox events. Retry transient persistence failures; safely
  acknowledge already-terminal/idempotent outcomes.
- GET handlers are read-only: no database/outbox writes, notifications, cache writes,
  or intent creation. Manual-payment intent belongs in an authenticated,
  CSRF-protected, idempotent POST and must be durable.
- Use `provider-money.ts` and domain money helpers at provider boundaries. Never
  perform financial arithmetic through `Number`, `parseFloat`, or binary floats.
- Do not log credentials, signatures, full raw provider payloads, payment details, or
  other secrets. Return canonical DTOs, not provider payloads or raw database rows.

## Verification gates

Commands assume the repository root. Run targeted tests first:

```bash
cd backend
npx vitest run test/payment-webhooks.test.ts test/payment-money.test.ts test/ledger.test.ts test/test-payments-gate.test.ts test/test-payments.test.ts
```

Then run the complete D4 backend gate:

```bash
cd backend
npm run lint
npm run build
npm test
```

For payment routes, callbacks, manual intent, or shared contract changes, also run:

```bash
cd frontend
npm run typecheck
npm run i18n:check
npm test
npm run build
```

```bash
node e2e/scripts/run.mjs
```

If persistence requires a schema change, use only an isolated non-production test
database and run:

```bash
cd backend
npm run migrate:deploy
npm run migrate:deploy
npx vitest run test/schema-contract.test.ts
```
