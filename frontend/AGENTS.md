# Frontend Agent Rules

These rules apply to `frontend/**` in addition to the repository root `AGENTS.md`.

## App Router and boundaries

- Routes live under `app/[locale]/`. Keep components server-side by default; add
  `"use client"` only when hooks, browser APIs, client state, or React Query require it.
- Keep metadata and static server reads in server files. Use `lib/server-api.ts` only
  from server-rendered code; browser requests must use `apiFetch()` from `lib/api.ts`.
- Split interactive route UI into a client component when the route also needs server
  metadata or data, following `app/[locale]/products/[id]/ProductPageClient.tsx` and
  `app/[locale]/games/[slug]/GameCatalogClient.tsx`.
- Do not import `window`, `document`, Zustand, or React Query across a server boundary.
- Do not force-remount providers or route trees to reset state. Preserve the single
  `QueryClient`, auth store, currency provider, and realtime provider across navigation;
  reset state explicitly when the domain event requires it.

## API contracts and server state

- `apiFetch()` owns the same-origin `/api` rewrite, credentials, CSRF header, locale
  header, refresh rotation, and session synchronization. Do not replace it with direct
  browser `fetch()` for backend endpoints.
- Type every response with the endpoint-specific DTO or response shape. Do not add new
  uses of the deprecated broad `Product` or `Order` aliases in `lib/api.ts`.
- `lib/contracts.ts` is the browser-local mirror of `shared/contracts/**` because the
  production frontend Docker context is isolated. A public wire-contract change must
  update both copies and keep `backend/test/shared-contracts-sync.test.ts` passing.
- React Query owns remote server state. Use stable array query keys containing every
  request input, and use `enabled` when an ID or authenticated user is not yet available.
- Render loading, unavailable/stale, and empty states separately. Reuse
  `components/QueryErrorState.tsx` for retryable query failures.
- After mutations or realtime events, update or invalidate every affected query-key
  family. Optimistic updates must cancel, snapshot, roll back on error, and reconcile.

## Authentication state

- `lib/auth-store.ts` is the only Zustand auth store. Keep tokens in HTTP-only cookies;
  the persisted auth cache may contain only the validated, non-sensitive user profile.
- Preserve the `unknown`, `authenticated`, `anonymous`, and `degraded` states. Hydration
  or refresh may infer anonymous only from a definitive `401` or `403`; transient
  failures stay degraded, while explicit logout always clears local auth state.
- Feature code should use store actions rather than direct `useAuth.setState()` calls.
  Direct state writes are reserved for the provider bootstrap and tests.
- Do not bypass the refresh/session coordination in `lib/api.ts`, or clear auth/query
  state merely because a component remounted.

## Internationalization and navigation

- URL locales are `ua`, `ru`, and `en`; the `ua` URL maps to the `uk` language/Intl
  locale. `i18n/config.ts` is the single source of truth.
- Client components use `useI18n()`; server metadata uses `getT()`. Add user-facing text
  to the matching namespace in all three locale directories with identical keys and
  placeholders. Do not expand the hardcoded-string baseline.
- Use `Link`, `useRouter`, and `usePathname` from `lib/navigation.tsx` for internal app
  navigation. `useSearchParams` may still come from `next/navigation`.
- Use `lib/locale-format.ts` with the active app locale. Do not hardcode regional locale
  identifiers or rely on the browser-default locale for `Intl` or `toLocale*` calls.

## Money

- Wire and persisted money is an integer decimal string of cents. Use
  `WireMoneyCents`/contract `MoneyCents` at API boundaries and `bigint` for arithmetic.
- Use helpers from `lib/money.ts` or `lib/currency.tsx`; never apply `Number`, `parseInt`,
  `parseFloat`, or floating-point ratios to money values.
- Parse editable major-unit strings with `majorUnitsToMoneyCents()` and serialize the
  resulting `bigint` as a decimal string. Format client amounts with `useMoney()`.
- Accounting views must preserve the source currency; do not silently display a
  converted amount as if it were the booked amount.

## Risk-based checks

Run commands from `frontend/` using the Node.js 20 toolchain used by CI.

```bash
# Any TypeScript or TSX behavior change
npm run typecheck

# Examples of running one real Vitest file while iterating
npm test -- test/auth-store.test.ts
npm test -- test/currency.test.tsx

# Translation, visible copy, locale navigation, or locale formatting
npm run i18n:check

# Auth/session, money, security, shared contracts, or broad query-cache changes
npm test

# App routes, layouts, providers, middleware, Next/Sentry config, or dependencies
npm run build

# Public wire-contract changes (run from frontend/)
cd ../backend && npx vitest run test/shared-contracts-sync.test.ts
```

- A route/config/provider change follows root D2: run `typecheck`, `i18n:check`, the
  full frontend test suite, and `build`; auth/session/navigation changes also require
  the applicable E2E coverage.
- A high-risk auth, money, payment/order UI, or public-contract change requires the full
  frontend test suite; add `build` whenever an App Router or client/server boundary moves.
- A leaf component change needs `typecheck` and its targeted tests, not an unrelated full
  suite. Documentation-only changes need `git diff --check` unless commands changed.
- Report exact commands and outcomes. A timeout or an unavailable dependency is not PASS.
