# Stage 7 — visibility, pagination, and search

Checkpoint date: 2026-09-19. Parent: `18e99912df566e49f0c04ce132c1f4bbf3230d1b`.
This is a local intermediate milestone; publication and accumulated browser/release
checks belong to the approved Stage 8 D5 gate, not an unverified push.

## Changes and boundaries

- Shared public catalog eligibility now covers browse/detail/suggestions, favorites,
  seller cards/counts, and product chat creation. Hidden ancestors cannot expose their
  descendants through a direct schema endpoint.
- Cache invalidation remains post-commit. Generation/CAS prevents stale refills;
  bounded database checks on cache hits prevent blocked product, rejected media, and
  hidden game disclosure when an invalidation fails. Aggregate counters are eventually
  refreshed during infrastructure failure, as documented in the visibility contract.
- Message moderation commits audit/outbox atomically; delayed creation does not expose
  hidden content, and moderation retries load current visibility. Chat removes hidden
  content immediately and ignores delayed history reinsertion.
- Growing nonfinancial lists use bounded keysets with stable tie-breakers, microsecond
  timestamps, and exact lookahead. Marketplace cursors bind to filter/sort inputs.
  Catalog snapshots fail visibly above their safety bounds.
- Next metadata and sitemap no longer maintain a separate moderation cache. Sitemap
  follows bounded newest-keyset traversal with a repeated-cursor guard.
- JSON-LD serialization escapes `<` before embedding seller-controlled text in HTML.
  The regression parses server-rendered HTML, requires exactly one script, and verifies
  that JSON parsing recovers the original closing-script injection payload unchanged.

The full role matrix is in [moderation-visibility.md](moderation-visibility.md).
Financial sorts/cursors and mixed financial permissions remain unchanged and are
listed in [deferred-financial-scope.md](deferred-financial-scope.md). No new migration
or speculative search index is introduced. Rollback is a code revert; browser and
API pagination contracts must move together.

## Verification evidence

Local Windows, pinned Node 20.20.2/npm 10.8.2, disposable PostgreSQL 16/Redis 7;
synthetic data and disabled external providers only.

| Check | Status | Evidence |
| --- | --- | --- |
| Backend lint/typecheck/build after cache guard | PASS | Exit 0; lint 0 errors, 21 existing warnings. |
| Backend complete isolated gate, 2026-09-11 | PASS | Exit 0; 62 files/649 tests, 231.7s; clean install, lint/typecheck/build, migrations twice and schema checks; total 349.1s. Final narrow SQL projection verified separately below. |
| Final backend regressions, 2026-09-19 | PASS | Exit 0; 9 files/81 tests, Vitest 49.08s, isolated harness 55.67s. Rate limits, visibility, cache, pagination, chat, reports, outbox and explicit SQL contract. |
| `node scripts/verify-all.mjs --only frontend` | PASS | Exit 0; 25 files/166 tests, 41.9s; production build 102.3s; total 299.9s. Lint/typecheck/i18n also passed; i18n retains 25 existing warnings. |
| New frontend metadata/sitemap/server-fetch regressions | PASS | Exit 0; 3 files/14 tests, 24.81s. |
| Final frontend regressions, 2026-09-19 | PASS | `npm test -- test/json-ld.test.tsx test/product-server-visibility.test.tsx test/server-api.test.ts test/sitemap.test.ts test/chat-panel.test.tsx`: exit 0, 5 files/21 tests, 31.49s. |
| Financial freeze against `origin/main` | PASS | Exit 0; base `24da6b29d07b`; no guard exceptions added. |
| `git diff --check` | PASS | Exit 0; only Git line-ending notices. |
| Search benchmark | PASS | Prior 20,000-product isolated run and EXPLAIN evidence in [search.md](search.md); exact-commit rerun recorded at the next checkpoint. |
| Accumulated E2E, D5, push, exact-SHA CI | NOT RUN | Required at Stage 8; a local unit test is not browser or provider evidence. |

Graphify AST update completed: 4,014 nodes, 10,171 edges; output remains ignored.
The scoped cache/visibility query was checked against the actual SQL, cache service,
routes, and direct callers. The new cache-hit admission path now includes PostgreSQL;
no financial producer dependency was introduced. During final verification, backend
test implementation owned three files, frontend regression implementation three files,
and a separate read-only review challenged cache-failure behavior. At most two agents
ran concurrently; no duplicate review/dependency service was installed.

Dependency repair was committed separately in the parent commit. Stage 8 environment,
CSP, telemetry routing, Docker and runner changes remain outside this Stage 7 commit.
The accumulated final committed SHA still requires a new full D5 and exact-SHA CI
before Stage 9. Earlier checks above are dated evidence, not publication certification.
