# Production hardening cycle 3 progress

Branch: `hardening/cycle-3`. Baseline: `docs/current-hardening-baseline.md`
(main @ `48f994d`). Stage order and scope follow the cycle-3 hardening task.

## Stage 0: baseline

Status: complete.

- Commit: `docs(hardening): refresh baseline and remaining plan`
- All baseline checks ran for real: backend lint/build/test (218/218), frontend
  typecheck/i18n/test (6/6)/build, compose config, compose image builds — PASS.
- Full capability table and confirmed-defect inventory live in the baseline document.

## Stage 1: domain invariants

Status: complete.

Commit: `fix(domain): reconcile marketplace lifecycle invariants`

### Confirmed drift

1. Docs described a `created` order status; the schema has used `pending` since the
   initial migration (plus `canceled` since `1782658636398`, used by the mock payment
   failure flow).
2. Docs documented the platform fee as `ceil`; the code (and the booked ledger
   history) uses floor.
3. Docs granted dispute resolution to moderators; every resolution endpoint requires
   `admin`.
4. Docs referenced a nonexistent `wallets.balance_cents`; the schema has
   `available_cents` + `escrow_cents`.
5. Catalog sections accepted `service` as an allowed delivery type
   (`game_sections_allowed_delivery_types_check` and the section service), while
   `products.delivery_type` has always rejected it — a section configured that way
   produced lots failing with a DB 500 instead of a 400. The admin UI offered the
   same phantom option.
6. The actual dispute lifecycle has four states (`open, resolving, resolved,
   resolution_failed`) — the recovery states from migration `1783290400000` are load
   bearing and are now part of the canonical enum.
7. Lifecycle values (roles, statuses, kinds, types) were string literals duplicated
   across Zod schemas, services, and the frontend with no single source of truth.

### Implementation

- Added `backend/src/domain/enums.ts` — canonical const arrays + types + guards for
  OrderStatus, ProductStatus, DisputeStatus, DisputeDecision, DeliveryType,
  ProductType, CatalogStatus, CatalogSchemaStatus, Role, MessageKind.
- Added `backend/src/domain/money.ts` — `platformFeeCents` (floor, BigInt-exact,
  input-validated); `ledger.service.ts` now delegates to it. No rounding-direction
  change: floor was already the booked rule.
- Zod schemas and services now derive from the canonical arrays: marketplace product
  create (deliveryType/productType), dispute resolve decision, catalog section
  validation, catalog status helpers, `common/types.ts` Role.
- Migration `1783291000000_reconcile-delivery-types.sql`: strips `service` from
  `game_sections.allowed_delivery_types`, restores the default pair for sections left
  empty, re-creates the CHECK as `<@ {instant,manual}` plus non-empty. Local dev/test
  data contained zero affected rows; the backfill still handles them.
- Section service now rejects empty `allowedDeliveryTypes`; admin `SectionForm` no
  longer offers `service` as a delivery type.
- New `docs/domain-invariants.md` — canonical sets, order transition graph as
  currently implemented, fee rule, money/ledger invariants, dispute permission
  matrix. `product-behavior.md`, `AGENTS.md`, `testing.md` reconciled to it.

### Regression coverage (`backend/test/domain-invariants.test.ts`, 22 tests)

1. Every lifecycle CHECK constraint's literal set equals the canonical enum
   (orders, products ×3, disputes ×2, users.role, messages.kind, catalog ×4).
2. Every canonical order status round-trips through the DB; `created` is rejected by
   `orders_status_check`.
3. `service` and empty delivery-type lists are rejected at both the DB constraint and
   the catalog service; manual/instant sections still work.
4. Fee: floor behavior on odd amounts, BigInt exactness at `MAX_SAFE_INTEGER` cents,
   invalid input rejection.
5. Docs scan: no `created` order status, fee documented as floor, wallet docs
   reference real columns.

### Verification

| Command | Result |
| --- | --- |
| `cd backend && npm run lint` | PASS |
| `npx vitest run test/domain-invariants.test.ts` | PASS, 22/22 |
| `cd backend && npm test` | PASS, 240/240 in 24 files |
| Clean-database migration smoke (marketplace_smoke, all 36) | PASS |
| `cd frontend && npm run typecheck` | PASS |
