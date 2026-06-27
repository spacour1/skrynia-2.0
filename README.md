# EscrowMarket MVP

A production-oriented MVP for a peer-to-peer digital marketplace similar to FunPay: listings, escrow payments, order lifecycle, order chat, wallet ledger, reviews, disputes, and admin moderation.

## Stack

- Frontend: Next.js, React Query, Zustand, TailwindCSS
- Backend: Express, TypeScript, PostgreSQL, Redis, WebSocket chat
- Storage: local upload storage by default, S3-compatible config supported
- Payments: pluggable provider interface with mock, Stripe, and Fondy simulation, real LiqPay, Monobank Acquiring, and WayForPay integrations, plus a manual bank-transfer option confirmed by an admin

## Quick Start With Docker

```bash
cp .env.example .env
# edit .env and set real values for POSTGRES_PASSWORD, JWT_SECRET, METRICS_PASSWORD
docker compose up --build
```

Email verification (registration confirmation, password reset) needs `RESEND_API_KEY` set —
see [docs/email-verification.md](docs/email-verification.md) for setup and local testing
without a real mail provider. (Mail is sent over Resend's HTTPS API rather than SMTP,
since most PaaS hosts block outbound SMTP ports.)

Open:

- Frontend: http://localhost:3000
- Backend health: http://localhost:4000/health

The backend container applies the database schema automatically on startup. It does **not** seed demo users in this mode (production images should never auto-create accounts with known passwords). To load demo data manually:

```bash
docker compose exec backend node dist/db/seed.js
```

## Development With Docker

Use this mode while editing code. It runs Next.js and the API in watch mode inside Docker, so host Node.js is not required.

```bash
docker compose -f docker-compose.dev.yml up
```

Useful commands:

```bash
docker compose -f docker-compose.dev.yml down
docker compose -f docker-compose.dev.yml logs -f backend
docker compose -f docker-compose.dev.yml logs -f frontend
```

Demo password for all seeded users:

```text
Password123!
```

Accounts:

- buyer@example.com
- seller@example.com
- admin@example.com

## Local Development

Backend:

```bash
cd backend
cp .env.example .env
npm install
npm run migrate
npm run seed
npm run dev
```

Frontend:

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

## Automated Tests

The backend has a Vitest suite covering the escrow/ledger money logic (`lockEscrow`,
`releaseEscrow`, `refundEscrow`) and the cents/decimal money parsing in `validation.ts`.
It runs against a real Postgres database (no mocking of SQL), using the `mock` payment
provider so it never touches a real payment gateway.

```bash
cd backend
docker exec <postgres-container> psql -U marketplace -d marketplace -c "CREATE DATABASE marketplace_test"
TEST_DATABASE_URL=postgres://marketplace:marketplace@localhost:5432/marketplace_test npx node-pg-migrate up --envPath .env
npm test
```

`TEST_DATABASE_URL` defaults to `postgres://marketplace:marketplace@localhost:5432/marketplace_test`
if not set. CI (`.github/workflows/ci.yml`) spins up its own throwaway Postgres service, runs
migrations, then `npm run lint` and `npm test` for the backend, and `npm run typecheck` for the
frontend, on every push and pull request.

## Core Flow

1. Register or log in as a seller.
2. Create a listing in `/seller/products`.
3. Log in as a buyer and open the marketplace.
4. Buy a product; the mock payment provider captures payment and locks funds in escrow.
5. Seller opens the order, starts work, and marks delivery.
6. Buyer confirms delivery; escrow releases seller funds minus the platform fee.
7. Buyer can leave a review after completion.

## Smoke Test

After `docker compose up --build`, run this from PowerShell:

```powershell
.\scripts\smoke-test.ps1
```

It logs in as the seeded buyer and seller, creates a listing, buys it, locks escrow, delivers, confirms, releases funds, and leaves a review.

## Escrow Model

This MVP uses an internal virtual ledger, not real banking logic.

- Payment capture creates an escrow hold on the seller wallet.
- Seller available balance is not credited until completion.
- Disputes freeze funds by moving the order to `disputed`.
- Admin can resolve disputes by refunding the buyer or releasing funds to the seller.
- Platform fee defaults to `PLATFORM_FEE_BPS=1000` (10%).

## Important Endpoints

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/verify-email/request` / `POST /auth/verify-email/confirm` (see [docs/email-verification.md](docs/email-verification.md))
- `POST /auth/password/forgot` / `POST /auth/password/reset`
- `GET /marketplace/products`
- `POST /marketplace/products`
- `POST /orders`
- `POST /payments/orders/:orderId/pay`
- `POST /payments/orders/:orderId/liqpay/checkout`
- `POST /payments/orders/:orderId/monobank/checkout`
- `POST /payments/orders/:orderId/wayforpay/checkout`
- `GET /payments/orders/:orderId/manual/details`
- `GET /admin/orders/pending`
- `POST /admin/orders/:id/confirm-payment`
- `POST /orders/:id/start`
- `POST /orders/:id/deliver`
- `POST /orders/:id/confirm`
- `POST /disputes/orders/:orderId/dispute`
- `POST /disputes/:id/resolve`
- `GET /users/me/wallet`
- `GET /admin/overview`

## SEO

The frontend serves a dynamic `/sitemap.xml` (home, games, and the first ~2000 active
products) and `/robots.txt` (disallows private routes: admin, dashboard, favorites,
login, register, messages, orders, seller, settings, wallet). Product and game pages get
per-page `<title>`/description/Open Graph tags and `Product` JSON-LD, generated server-side
in `app/products/[id]/page.tsx` and `app/games/[slug]/page.tsx`. Set `NEXT_PUBLIC_SITE_URL`
to the real deployed domain in production — it's used as the canonical base for all of this.

## Notes For Production Hardening

- Replace simulated payment providers with real webhooks and idempotency keys.
- Move JWT secret and payment credentials to a secret manager.
- Add stronger fraud/risk rules (email verification and Telegram login signature checks are in place).
- Wire up an automated payout rail (e.g. LiqPay P2P payouts) — withdrawals currently go through
  manual admin review and bank transfer confirmation (`/admin/payouts`).
- Add object scanning for uploads.
- Add observability, backups, and admin audit logs.
- Set `NEXT_PUBLIC_SITE_URL` to the production domain (used by the sitemap and OG tags).
