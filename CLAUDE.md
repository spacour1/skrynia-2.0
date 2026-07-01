# SKRYNIA 2.0 — Claude Code Instructions

## Project overview

P2P digital marketplace with escrow. Buyers pay into escrow, sellers fulfill orders, funds release on buyer confirmation (or auto-release after 72 h). Disputes go to admin/moderator review. Backend is Node.js/Express + TypeScript (ESM), frontend is Next.js 14 App Router.

## Commands

```bash
# Backend
cd backend
npm run lint          # tsc --noEmit — run before every commit
npm test              # vitest run
npm run migrate       # apply pending migrations
npm run migrate:down  # roll back one migration
npm run migrate:create -- <name>   # create new migration (SQL)
npm run seed          # reset demo data (dev only)
npm run dev           # tsx watch src/server.ts

# Frontend
cd frontend
npm run typecheck     # tsc --noEmit — run before every commit
npm run build         # catches static-generation / boundary errors tsc misses
npm run dev           # next dev

# Docker (from repo root)
docker compose -f docker-compose.dev.yml up
docker compose -f docker-compose.dev.yml exec backend npm run migrate
docker compose -f docker-compose.dev.yml exec backend npm run seed
```

## Critical rules

**Money**
- All amounts are stored and calculated in integer cents/minor units. Never use floats for money.
- Platform fee is `PLATFORM_FEE_BPS` env var (default 1000 = 10%). Access via `env.PLATFORM_FEE_BPS`.
- The ledger (`ledger_entries` / `ledger_lines`) is immutable — a DB trigger forbids UPDATE/DELETE. Post a correcting entry instead of modifying existing rows.
- Every money-moving operation must call the corresponding `record*Ledger()` function in `accounting.service.ts` inside the same DB transaction.

**Order & escrow flow**
Do not change the order status machine, escrow logic, wallet mutations, or payment webhook handling without adding tests. The golden path is:
`created → paid → in_progress → delivered → completed` (+ `disputed → resolved`, `canceled`, `refunded`).

**Payment callbacks**
All provider callbacks (`/payments/liqpay/callback`, `/payments/monobank/callback`, `/payments/wayforpay/callback`) must remain idempotent. They use `on conflict (idempotency_key) do nothing` in the ledger — do not remove this.

**Schema changes**
Every schema change requires a new migration file (numeric timestamp prefix, SQL format):
```
npm run migrate:create -- <kebab-case-description>
```
Add a rollback note as a comment at the top of the migration. Never edit applied migrations.

**Secrets**
Never log or expose: `JWT_SECRET`, `LIQPAY_PRIVATE_KEY`, `WAYFORPAY_MERCHANT_SECRET_KEY`, `MONOBANK_TOKEN`, `RESEND_API_KEY`, `TWILIO_AUTH_TOKEN`, `TELEGRAM_BOT_TOKEN`, `DATABASE_URL`. Do not connect AI tools to the production database.

**Roles**
Three roles only: `user`, `moderator`, `admin`. Moderators can access `/admin` routes except financial endpoints (transactions, ledger, payouts, reconciliation, manual adjustments) — those are `adminOnly`.

**PR discipline**
All meaningful changes go through a PR, not direct push to `main`. CI must be green before merge.

## Architecture quick-reference

See `docs/architecture.md` for full detail.

- `backend/src/modules/` — one folder per domain (auth, orders, payments, disputes, chat, marketplace, users, admin, jobs, notifications)
- `backend/src/common/` — middleware (auth, CSRF, RBAC, security), errors, cookies, logger, redis, mailer, telegram-bot
- `backend/src/db/` — pool (with `inTx()` helper), seed
- `backend/migrations/` — SQL migrations, numeric timestamp filenames
- `frontend/app/` — Next.js App Router pages
- `frontend/components/` — shared components
- `frontend/lib/` — api.ts (typed fetch wrapper), auth-store.ts (Zustand), i18n.ts

## ESM import rules

All backend imports must use `.js` extensions (even for `.ts` source files). TypeScript is compiled to ESM.

```ts
// correct
import { pool } from "../../db/pool.js";
// wrong
import { pool } from "../../db/pool";
```

## Database transactions

Use `inTx()` from `db/pool.ts` for any operation that spans multiple queries:

```ts
import { inTx } from "../../db/pool.js";

const result = await inTx(async (client) => {
  await client.query(...);
  await client.query(...);
  return something;
});
```

Never use bare `pool.query("begin")` — it may run on different pool connections.

## Required checks before marking a task done

1. `cd backend && npm run lint` — no TypeScript errors
2. `cd frontend && npm run typecheck` — no TypeScript errors
3. If schema changed: migration file exists with rollback note
4. If money logic changed: ledger functions called inside transaction
5. If payment callback changed: idempotency preserved
