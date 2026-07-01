# SKRYNIA 2.0 — Agent Rules

## What this repo is

P2P digital marketplace with escrow. Buyers pay, funds are held in escrow, sellers fulfill, funds release on buyer confirmation or after a 72-hour timeout. Disputes go to admin/moderator review. Stack: Node.js/Express + TypeScript (ESM) backend, Next.js 14 App Router frontend, PostgreSQL, Redis/BullMQ.

## Hard constraints — never violate

- **No floating-point money.** All amounts are integer cents. `amountCents: number` — always integers.
- **Ledger is append-only.** The DB has a trigger that blocks UPDATE/DELETE on `ledger_entries` and `ledger_lines`. Corrections go through a new entry, never by rewriting history.
- **Every money mutation books a ledger entry** inside the same DB transaction. See `accounting.service.ts`.
- **Payment callbacks must stay idempotent.** They rely on `on conflict (idempotency_key) do nothing`. Do not remove this pattern.
- **Do not change the order status machine** (`created → paid → in_progress → delivered → completed`, plus `disputed/resolved/canceled/refunded`) without adding tests that cover the transition.
- **Never expose secrets** in logs, responses, or error messages: JWT_SECRET, payment provider keys, webhook secrets, DATABASE_URL, admin credentials.
- **Never connect to the production database** from a development or AI tool context.
- **All schema changes require a migration file** (numeric timestamp prefix, SQL, with rollback note).
- **Changes go through PR**, not direct push to `main`.

## Required checks

```bash
# Backend — must pass before committing
cd backend && npm run lint    # tsc --noEmit
cd backend && npm test        # vitest run (when tests exist for changed code)

# Frontend — must pass before committing
cd frontend && npm run typecheck   # tsc --noEmit
cd frontend && npm run build       # catches boundary/static-gen errors
```

CI runs the same checks on every PR (`.github/workflows/ci.yml`).

## Smoke flow to verify end-to-end

1. Buyer creates order → chat conversation created, "order_created" system message appears
2. Payment hold confirmed by provider webhook → "payment_received" system message
3. Seller marks started → "seller_started" system message
4. Seller marks delivered → "delivery_sent" system message
5. Buyer confirms receipt → escrow releases, platform fee deducted, "escrow_released" system message
6. Wallet balance of seller increases by `amount - platform_fee`

Verify ledger is balanced: `sum(debit_cents) = sum(credit_cents)` across all `ledger_lines` for any single `ledger_entry`.

## Key files to read before touching each domain

| Domain | Key files |
|--------|-----------|
| Orders & escrow | `backend/src/modules/orders/orders.routes.ts`, `accounting.service.ts` |
| Payments | `backend/src/modules/payments/payments.routes.ts` |
| Disputes | `backend/src/modules/disputes/disputes.routes.ts` |
| Wallet | `backend/src/modules/users/wallet.service.ts` |
| Auth / 2FA | `backend/src/modules/auth/` |
| Chat | `backend/src/modules/chat/chat.service.ts`, `ws.service.ts` |
| Admin / Reconciliation | `backend/src/modules/admin/admin.routes.ts` |
| Jobs | `backend/src/modules/jobs/queue.ts` |
| Notifications | `backend/src/modules/notifications/`, `backend/src/common/telegram-bot.ts` |
| DB schema | `backend/migrations/` (all `.sql` files, chronological) |

## Coding conventions

- ESM `.js` extensions required on all backend imports (TypeScript compiles to ESM).
- Use `inTx(async (client) => { ... })` from `db/pool.ts` for multi-query transactions. Never `pool.query("begin")`.
- Error helpers: `badRequest()`, `forbidden()`, `notFound()` from `common/errors.ts`. Never `res.status(400).json(...)` directly.
- Route handlers use `asyncHandler()` wrapper — no manual try/catch needed.
- Zod for all request body validation at the top of each route file.
- CSRF exempt paths are in `common/middleware/csrf.ts` — add pre-session endpoints there, not elsewhere.
- Role checks: `requireRole("admin")` or `requireRole("admin", "moderator")` from `common/middleware/rbac.ts`.

## Environment

Local dev runs via Docker Compose (`docker-compose.dev.yml`). Backend on port 4000, frontend on port 3000. See `docs/architecture.md` for full env var reference.
