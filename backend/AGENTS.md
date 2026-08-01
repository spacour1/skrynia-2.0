# Backend Agent Rules

## Scope

These rules apply to `backend/**` and inherit the repository root rules. A module
with its own `AGENTS.md` may impose stricter domain requirements.

## Backend conventions

- Backend TypeScript compiles to ESM. Use `.js` extensions on relative imports.
- Validate route params, queries, and bodies with Zod at the HTTP boundary.
- Wrap route handlers with `asyncHandler()` and use shared error helpers instead
  of hand-written response branches or repetitive `try/catch` wrappers.
- Use `inTx()` or `inSerializableTx()` from the database transaction helpers for
  multi-query mutations. Never issue transaction control through `pool.query()`.
- Keep provider and other network calls outside database transactions, especially
  financial and serializable transactions.
- Schema changes require a timestamped migration and rollback note. Never edit a
  deployed migration or validate a migration against production.
- Map database rows to explicit DTOs. Raw rows must not cross the HTTP boundary;
  preserve exact string representation for public money fields.
- Perform cache invalidation, WebSocket broadcasts, notifications, and queue work
  only after commit, using the domain outbox when durable delivery is required.
- Preserve idempotency keys and conflict-safe writes for retryable mutations.

## Backend risk gates

Use targeted tests while iterating, then satisfy the applicable final gate.

### D3 — low-risk backend

```bash
cd backend
npm run lint
npx vitest run <affected-tests>
npm run build
```

### D4 — high-risk backend

D4 applies to auth, sessions, 2FA, payments, orders, escrow, wallet, ledger,
disputes, storage ownership, outbox, WebSocket, runtime shutdown, migrations,
shared contracts, and money.

```bash
cd backend
npm run lint
npm run build
npm test
```

For migrations, after the build and only against an isolated non-production database:

```bash
npm run migrate:deploy
npm run migrate:deploy
npx vitest run test/schema-contract.test.ts
```

Cross-domain changes must also satisfy the applicable frontend, E2E, migration,
or release gate from the root and nearest scoped instructions.
