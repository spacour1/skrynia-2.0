# Production hardening stage 2 baseline

Recorded on 2026-07-19 before stage 2 code changes.

## Source state

- Branch: `fix/production-hardening-stage-2`
- Baseline commit: `72c7bbb29e39414e6d1d7dffabe971868b5d0088`
- Worktree: clean before checks
- Existing migrations: 28 forward migrations
- Latest migration: `1783290200000_add-dispute-resolving-status.sql`

## Checks

| Area | Command | Result | Notes |
| --- | --- | --- | --- |
| Git | `git status` | PASS | `main` was clean and matched `origin/main` before the stage branch was created. |
| Git | `git log --oneline --decorate -20` | PASS | Baseline HEAD was `72c7bbb`. |
| Backend | `npm ci` | PASS | 397 packages installed; audit reported 19 moderate vulnerabilities. |
| Backend | `npm run lint` | PASS | TypeScript no-emit check completed. |
| Backend | `npm run build` | PASS | TypeScript build completed. |
| Backend | `npm test` | FAIL | 162 tests discovered: 12 passed, 150 failed; 1/15 test files passed. PostgreSQL on `localhost:5432` and Redis on `localhost:6379` were unavailable, producing connection failures and 80 unhandled Redis errors. |
| Frontend | `npm ci` | PASS | 339 packages installed; audit reported 22 moderate and 3 high vulnerabilities. |
| Frontend | `npm run typecheck` | PASS | TypeScript no-emit check completed. |
| Frontend | `npm run i18n:check` | PASS | 0 errors and 25 legacy hardcoded-string warnings. |
| Frontend | `npm run build` | PASS | Next.js production build completed with two existing dynamic-dependency warnings from Sentry/OpenTelemetry dependencies. |
| Docker | `docker compose config` | FAIL | Compose interpolation requires `POSTGRES_PASSWORD`; no root `.env` currently supplies it. |

## Test inventory

- Backend: 162 Vitest tests across 15 files.
- Frontend: no test script, test runner, or test files are present.
- Backend integration tests require PostgreSQL at `localhost:5432` and Redis at
  `localhost:6379`; neither service was listening during this baseline.

## Migrations

The repository contains these 28 migration files, in order:

1. `1782518994595_initial-schema.sql`
2. `1782519411565_add-product-media-table.sql`
3. `1782586017591_add-payouts-and-email-verification.sql`
4. `1782655619496_centralize-chat-and-read-tracking.sql`
5. `1782655619497_add-user-blocks.sql`
6. `1782655619498_add-reports-and-moderation.sql`
7. `1782658636398_add-test-payments-config-and-canceled-status.sql`
8. `1782659452265_add-game-sections-product-type.sql`
9. `1782659906648_add-category-risk-level.sql`
10. `1782660177746_add-user-mute.sql`
11. `1782686932438_add-phone-verification.sql`
12. `1782687000001_add-moderator-role.sql`
13. `1782687000002_add-system-messages.sql`
14. `1782687000003_add-ledger-immutability.sql`
15. `1782687000004_add-notification-delivery.sql`
16. `1782687000005_add-real-2fa.sql`
17. `1782700000001_add-marketplace-indexes.sql`
18. `1782700000002_add-i18n-locale-support.sql`
19. `1782700000003_add-conversation-context-uniqueness.sql`
20. `1783289700365_add-catalog-groups.sql`
21. `1783289701862_add-catalog-lifecycle-fields.sql`
22. `1783289703323_add-catalog-section-schemas.sql`
23. `1783289704756_add-products-schema-version.sql`
24. `1783289800000_add-catalog-display-fields.sql`
25. `1783289900000_add-games-catalog-type.sql`
26. `1783290000000_reconcile-schema-guards.sql`
27. `1783290100000_clear-audit-request-bodies.sql`
28. `1783290200000_add-dispute-resolving-status.sql`

## Known baseline limitations

- The backend suite cannot provide a code-health signal until its PostgreSQL and Redis
  dependencies are running and the migrated `marketplace_test` database exists.
- The frontend has no automated unit or integration tests.
- Compose validation requires local secret values and currently fails before service
  configuration can be rendered.
- Dependency audits are not clean: backend has 19 moderate findings; frontend has
  22 moderate and 3 high findings.
- The i18n check accepts 25 groups of legacy hardcoded Cyrillic strings as warnings.
- The frontend build emits existing Sentry/OpenTelemetry dynamic dependency warnings.
- External payment, email, SMS, and Telegram integrations are covered only by mocks;
  no live third-party calls were made.
- There is no production Docker build smoke test in the current repository.
