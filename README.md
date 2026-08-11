# SKRYNIA 2.0

P2P digital marketplace with escrow: buyers pay, funds are held, sellers fulfill,
and funds release on buyer confirmation or timeout. Disputes go to admin or
moderator review.

## Stack

- Backend: Node.js, Express, TypeScript ESM, PostgreSQL, Redis, BullMQ, WebSocket
- Frontend: Next.js 15 App Router, React 19, React Query, Zustand, TailwindCSS
- Payments: mock/dev provider plus LiqPay, Monobank, WayForPay, and manual bank transfer paths
- Storage: local uploads in dev, S3-compatible storage in production

## Start In Docker

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
docker compose -f docker-compose.dev.yml up
```

Open:

- Frontend: http://localhost:3000
- Backend health: http://localhost:4000/health

Useful commands:

```bash
docker compose -f docker-compose.dev.yml down
docker compose -f docker-compose.dev.yml logs -f backend
docker compose -f docker-compose.dev.yml logs -f frontend
```

The dev compose command installs dependencies, applies migrations, and starts the
frontend, API, BullMQ worker, and outbox in watch mode. It intentionally does not
reset or seed data on startup; run `npm run seed` explicitly when a fresh demo
dataset is required.

For a production-shaped local smoke test, fill a root `.env` from `.env.example`
and use the root Compose file:

```bash
docker compose config --quiet
docker compose build
docker compose up -d
docker compose ps
```

That topology runs one release-only `migrate` job, then independent API, BullMQ
worker, and transactional-outbox processes. Application containers never run
migrations in their startup command. See `docs/deployment.md` before using this
topology outside a local or single-host environment; multi-replica uploads require
S3-compatible object storage.

## Demo Accounts

All seeded users use:

```text
Password123!
```

Core accounts:

- buyer@example.com
- admin@example.com
- moderator@example.com
- nova.accounts@example.com
- pixel.boost@example.com
- keyforge.market@example.com
- raid.supply@example.com

Seeded accounts are email-verified for local development.

## Smoke Test

After the dev stack is running:

```powershell
.\scripts\smoke-test.ps1
```

The script logs in as buyer and seller, creates a listing, creates an order,
captures mock payment, starts delivery, confirms completion, and leaves a review.

## Playwright E2E

Run the isolated production-shaped browser suite:

```bash
node e2e/scripts/run.mjs
```

It creates disposable PostgreSQL/Redis volumes, migrates and seeds them, starts
separate API/worker/outbox/frontend services, runs Chromium with one worker, and
always removes containers and volumes. Real payment APIs are never used. See
[`docs/e2e.md`](docs/e2e.md) for safety gates, covered flows, and failure
artifacts.

## Required Checks

```bash
docker compose -f docker-compose.dev.yml exec backend npm run lint
docker compose -f docker-compose.dev.yml exec backend npm test
docker compose -f docker-compose.dev.yml exec frontend npm run typecheck
docker compose -f docker-compose.dev.yml exec frontend npm run build
```

For backend tests inside Docker, make sure the test database exists and migrations
are applied to it:

```bash
docker compose -f docker-compose.dev.yml exec -T postgres psql -U marketplace -d marketplace -c "CREATE DATABASE marketplace_test"
docker compose -f docker-compose.dev.yml exec -T -e DATABASE_URL=postgres://marketplace:marketplace@postgres:5432/marketplace_test backend npx node-pg-migrate up --envPath .env
docker compose -f docker-compose.dev.yml exec -T -e TEST_DATABASE_URL=postgres://marketplace:marketplace@postgres:5432/marketplace_test -e TEST_REDIS_URL=redis://redis:6379/15 backend npm test
```

## Read Next

- Agent and contributor rules: `AGENTS.md`
- Fast repository map: `docs/agent-map.md`
- Architecture: `docs/architecture.md`
- Testing: `docs/testing.md`
- Playwright E2E: `docs/e2e.md`
- Deployment: `docs/deployment.md`
- Product behavior: `docs/product-behavior.md`
- Email verification: `docs/email-verification.md`
- Telegram bot: `docs/telegram-bot.md`
