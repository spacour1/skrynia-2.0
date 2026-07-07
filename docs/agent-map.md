# Agent Map

This file is the fast entrypoint for humans and AI agents. Read it before opening
large route or page files.

## Ignore By Default

- `node_modules/`, `.next/`, `dist/`, `uploads/`, coverage output
- `package-lock.json` unless the task is dependency resolution
- `backend/migrations/` unless the task changes schema, data shape, ledger, or order invariants
- `frontend/public/assets/` unless the task is visual assets
- `frontend/i18n/locales/` unless the task is translations or copy

## Runtime Entry Points

- Backend app wiring: `backend/src/app.ts`
- Backend server, WebSocket, worker startup: `backend/src/server.ts`
- Frontend app shell: `frontend/app/[locale]/layout.tsx`
- Frontend providers: `frontend/app/[locale]/providers.tsx`
- Frontend API client: `frontend/lib/api.ts`
- Frontend navigation: `frontend/components/Nav.tsx`, `frontend/components/nav/`

## Backend Domains

| Domain | Start here |
| --- | --- |
| Auth, sessions, 2FA, email verification | `backend/src/modules/auth/auth.routes.ts`, `backend/src/modules/auth/session.service.ts` |
| Orders and escrow | `backend/src/modules/orders/orders.routes.ts`, `backend/src/modules/orders/ledger.service.ts` |
| Ledger accounting | `backend/src/modules/orders/accounting.service.ts` |
| Payments and webhooks | `backend/src/modules/payments/payments.routes.ts` |
| Test payments | `backend/src/modules/payments/test-payments.routes.ts` |
| Marketplace public browse | `backend/src/modules/marketplace/marketplace-browse.routes.ts` |
| Marketplace favorites | `backend/src/modules/marketplace/marketplace-favorites.routes.ts` |
| Marketplace product CRUD (seller) | `backend/src/modules/marketplace/marketplace-products.routes.ts` |
| Catalog builder — groups/items/sections CRUD | `backend/src/modules/catalog/catalog-groups.service.ts`, `catalog-items.service.ts`, `catalog-sections.service.ts`, `backend/src/modules/catalog/admin-catalog.routes.ts` |
| Catalog builder — schema versioning, section-chain gating | `backend/src/modules/catalog/catalog-schemas.service.ts` |
| Catalog builder — public/admin tree reads | `backend/src/modules/catalog/catalog-tree.service.ts` |
| Chat and WebSocket | `backend/src/modules/chat/chat.service.ts`, `backend/src/modules/chat/ws.service.ts` |
| Admin users and moderation | `backend/src/modules/admin/admin-users.routes.ts` |
| Admin finance and reconciliation | `backend/src/modules/admin/admin-finance.routes.ts`, `backend/src/modules/admin/reconciliation.service.ts` |
| Admin payouts | `backend/src/modules/admin/admin-payouts.routes.ts` |
| Admin reports and message moderation | `backend/src/modules/admin/admin-reports.routes.ts` |
| Admin ops (media, audit, jobs, listings, manual payment confirm) | `backend/src/modules/admin/admin-ops.routes.ts` |
| Wallet and profile | `backend/src/modules/users/users.routes.ts`, `backend/src/modules/users/wallet.service.ts` |
| Jobs and notifications | `backend/src/modules/jobs/queue.ts`, `backend/src/modules/notifications/notifications.service.ts` |

## Frontend Domains

| Domain | Start here |
| --- | --- |
| Home and marketplace | `frontend/app/[locale]/page.tsx`, `frontend/components/ProductCard.tsx` |
| Game catalog page | `frontend/app/[locale]/games/[slug]/GameCatalogClient.tsx` |
| Product page | `frontend/app/[locale]/products/[id]/ProductPageClient.tsx` |
| Seller listings | `frontend/app/[locale]/seller/products/page.tsx`, `frontend/app/[locale]/seller/products/_components/` |
| Create listing | `frontend/app/[locale]/seller/create/page.tsx` |
| Orders | `frontend/app/[locale]/orders/page.tsx`, `frontend/app/[locale]/orders/[id]/page.tsx` |
| Messages | `frontend/app/[locale]/messages/page.tsx`, `frontend/components/ChatPanel.tsx` |
| Settings and security | `frontend/app/[locale]/settings/page.tsx`, `frontend/app/[locale]/settings/_components/` |
| Admin catalog | `frontend/app/[locale]/admin/catalog/page.tsx`, `frontend/app/[locale]/admin/catalog/_components/`, `frontend/components/admin/catalog/SchemaBuilder.tsx` |
| Admin finance | `frontend/app/[locale]/admin/finance/page.tsx`, `frontend/app/[locale]/admin/finance/_components/` |

## Large Files To Split First

- `frontend/app/[locale]/settings/page.tsx` (~350 lines) and `frontend/app/[locale]/admin/finance/page.tsx` (~335 lines): mostly sequential query/mutation wiring for many independent sub-features; already extracted into `_components/`, remaining size is orchestration rather than dead weight

## Already Split

- `frontend/components/Nav.tsx`: shell stays in the file; search, catalog, profile, and notifications live in `frontend/components/nav/`
- `frontend/app/[locale]/seller/products/page.tsx` (~260 lines): page state stays in the file; the create-lot form fields live in `_components/LotFormFields.tsx`, with media, preview, tips, and listings also in `_components/`
- `frontend/app/[locale]/settings/page.tsx`: API state stays in the file; profile, language, password, 2FA, verification, notification, and info cards live in `_components/`
- `frontend/app/[locale]/admin/finance/page.tsx`: page state stays in the file; finance widgets, formatters, and types live in `_components/`
- `frontend/app/[locale]/admin/catalog/page.tsx` (~110 lines): only layout + selection dispatcher stays in the file; `GroupForm.tsx`, `ItemForm.tsx`, `SectionForm.tsx` (one per catalog level), tree nodes, small UI helpers, selection type, and auto-slug hook all live in `_components/`
- `backend/src/modules/marketplace/marketplace.routes.ts`: now a thin index mounting `marketplace-browse.routes.ts`, `marketplace-favorites.routes.ts`, `marketplace-products.routes.ts`; shared SQL fragments and helpers live in `marketplace.sql.ts` and `marketplace.helpers.ts`
- `backend/src/modules/admin/admin.routes.ts`: now a thin index applying the shared `authenticate` + `requireRole` gate and mounting `admin-users.routes.ts`, `admin-finance.routes.ts`, `admin-payouts.routes.ts`, `admin-reports.routes.ts`, `admin-ops.routes.ts`
- `backend/src/modules/catalog/catalog.service.ts`: now a 6-line barrel (`export * from ...`) re-exporting `catalog.helpers.ts` (shared audit/slug/status helpers), `catalog-groups.service.ts`, `catalog-items.service.ts`, `catalog-sections.service.ts` (also exports `getCatalogSectionRow`, used by the schemas module), `catalog-schemas.service.ts` (versioning + `resolveActiveSectionChain`), and `catalog-tree.service.ts` (public/admin tree reads) — existing imports from `./catalog.service.js` elsewhere in the backend keep working unchanged

## Verification Shortcuts

```bash
docker compose -f docker-compose.dev.yml exec backend npm run lint
docker compose -f docker-compose.dev.yml exec frontend npm run typecheck
docker compose -f docker-compose.dev.yml exec frontend npm run i18n:check
docker compose -f docker-compose.dev.yml exec frontend npm run build
```

`i18n:check` runs in CI (`.github/workflows/ci.yml`) and fails the build on new hardcoded UI strings. Moving code into a new file (e.g. splitting a page into `_components/`) moves its `HARDCODED_BASELINE` entry in `frontend/scripts/check-i18n.ts` too — otherwise pre-existing legacy strings turn into hard errors under their new path.

For money, order, payment, or ledger changes, also run backend tests and smoke:

```bash
docker compose -f docker-compose.dev.yml exec -T -e TEST_DATABASE_URL=postgres://marketplace:marketplace@postgres:5432/marketplace_test -e TEST_REDIS_URL=redis://redis:6379/15 backend npm test
.\scripts\smoke-test.ps1
```
