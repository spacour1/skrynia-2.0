# Production hardening stage 2 progress

## Stage 0: baseline

Status: complete.

- Commit: `48f9fd0 docs: record production hardening stage 2 baseline`
- Baseline source SHA: `72c7bbb29e39414e6d1d7dffabe971868b5d0088`
- Detailed results: `docs/hardening-stage-2-baseline.md`
- The initial backend test failure was confirmed as an environment issue. After starting
  local PostgreSQL/Redis, creating `marketplace_test`, and applying all 28 migrations,
  the unchanged baseline suite passed 162/162 tests.

## Stage 1: marketplace cache invalidation

Status: complete.

Planned commit: `fix(cache): invalidate marketplace visibility after moderation`

### Confirmed defect

- Public product detail returned `marketplace:product:{id}` before checking current
  product/seller visibility.
- Admin listing moderation did not invalidate any marketplace cache.
- Seller ban/unban did not invalidate product detail, list, seller, or aggregate caches.
- Category/game counters included active products from banned sellers.
- Stock and sales mutations left cached product/list payloads stale.
- Cache invalidation was duplicated across seller and moderation routes.

### Implementation

- Added one marketplace cache service with `ProductCacheContext`.
- Product detail keys are deleted in bounded batches.
- List and seller/game/category/section namespaces are removed in one Redis keyspace pass,
  avoiding one `SCAN` per product during seller ban.
- Seller ban loads every related product context in one SQL query, preserves existing
  session revocation and WebSocket disconnect behavior, and invalidates the batch once.
- Wired seller create/update/pause/activate/delete, admin block/delete/restore/promotional
  flags, media moderation, seller ban/unban, catalog mutations, payment stock decrement,
  and completed-sale counter increment.
- Product moves invalidate both their previous and new category/game/section contexts.
- Public category/game/section/suggestion counts now exclude banned sellers, matching
  public product visibility.
- No financial formula, provider, ledger, payout, or wallet-accounting behavior changed.
- No migration was required.

### Regression coverage

Added five integration scenarios that warm the real Redis cache before mutation and do
not manually clear it between the mutation and assertion:

1. Admin block makes the next anonymous detail request return 404; owner preview remains.
2. Seller ban removes the product from detail/list/counters; unban restores it immediately.
3. Category counts refresh after product create, delete, and block.
4. Rejected media disappears from an already cached product.
5. Stock refreshes after payment and sales count refreshes after escrow release.

The older public-visibility tests no longer manually delete each product cache key during
setup; UUID-isolated keys exercise normal behavior.

### Verification

| Command | Result |
| --- | --- |
| `cd backend && npm run lint` | PASS |
| `cd backend && npm run build` | PASS |
| Targeted Vitest cache/visibility run | PASS, 13/13 |
| `cd backend && npm test` | PASS, 167/167 in 16/16 files |
| `cd frontend && npm run typecheck` | PASS |
| `cd frontend && npm run i18n:check` | PASS, 0 errors and 25 baseline warnings |
| `cd frontend && npm test` | NOT AVAILABLE, package has no `test` script |
| `cd frontend && npm run build` | PASS, with existing Sentry/OpenTelemetry warnings |

### Remaining constraints

- Marketplace invalidation is best-effort when Redis is unavailable, consistent with the
  existing cache layer. Durable side effects belong to the later outbox stage.
- Frontend unit tests remain deferred to the frontend reliability stage.
