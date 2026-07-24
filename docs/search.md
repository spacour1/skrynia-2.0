# Marketplace search

## Public behaviour

`GET /marketplace/products?q=...` and `GET /marketplace/suggest?q=...` normalize
case, accents, repeated whitespace, underscores, and Unicode/ASCII hyphens. Search uses
PostgreSQL's `simple` text-search configuration so Cyrillic and Latin tokens are kept
without English-only stemming.

When `q` is present, product results use deterministic relevance before any popularity
signal:

1. exact normalized title;
2. title prefix;
3. exact game alias;
4. exact game name;
5. trigram similarity (including exact category aliases);
6. full text;
7. `sales_count`;
8. `created_at`;
9. product ID as the stable final tie-break.

This order is intentional: an unrelated popular/recent product cannot outrank an exact
match. A request with `q` is relevance-ranked even if it also carries a `sort` value.
Without `q`, the existing price/rating/sales/discount/newest sorts are unchanged.
Punctuation-only input is rejected with `400` instead of normalizing to an empty
match-all prefix.

Catalog variants are data, not query-specific SQL branches:

- administrator-managed `games.aliases` supplies game variants;
- `categories.aliases` supplies cross-language listing-type variants;
- the Stage 13 migration backfills Counter-Strike, Valorant, Roblox, account, and
  boosting variants required by the product fixtures.

## Representation and maintenance

Migration `1784909494965_add-multilingual-product-search.sql` installs `pg_trgm` and
`unaccent`, then creates:

- `marketplace_product_search_documents`: one denormalized row per product;
- `marketplace_product_search_terms`: normalized phrases/tokens used for indexed typo
  retrieval;
- B-tree indexes for exact title/prefix and exact game name;
- GIN indexes for game/category alias arrays, `simple` `tsvector`, and trigram terms.

Each document includes product title and description, game name and aliases, category
name and aliases, section, product type, server, and platform. Product, game, category,
and section triggers refresh affected documents in the same database transaction.
Deleting a product cascades to its document and terms.

The per-product trigger runs its small refresh with function-local `jit=off`. PostgreSQL
otherwise JIT-compiled the complex maintenance statement for every ordinary listing
write in the local database: measured trigger time fell from 250.725 ms to 19.360 ms for
the first insert on a fresh session. Bulk backfill and dimension refresh functions keep
the server's normal JIT policy.

The term table is separate from the full document because whole-string trigram
similarity between a short typo and a long concatenated document is too low. For
example, `valroant` is compared with the normalized term `valorant`; the GIN trigram
index supplies candidates and the document table supplies the remaining relevance
tiers.

## Provider prerequisite

The local PostgreSQL 16.14 image successfully installed both extensions. This does not
prove that a production provider grants the same capability. Before rollout, run with
the deployment database role:

```sql
select name, default_version, installed_version
from pg_available_extensions
where name in ('pg_trgm', 'unaccent')
order by name;
```

If either row is absent or the role cannot execute `CREATE EXTENSION`, stop the release
before deploying application code that reads the search tables. Ask the provider to
enable the extensions; do not silently fall back to an unindexed `ILIKE`.

## Rollout and rollback

1. Record the current product count and database size.
2. Verify `pg_trgm`/`unaccent` availability with the release role.
3. Run the release migration job.
4. Verify one search document per product and inspect trigger/index presence.
5. Deploy API code.
6. Smoke the required Cyrillic/Latin aliases and one typo query.
7. Monitor migration transaction age, database CPU, query latency, and search-table
   size.

The indexes are created on the new empty tables, so their initial build does not lock
`products`. Existing products are refreshed in bounded 1,000-ID statements. The
repository release runner currently wraps pending migrations in one transaction:
batching bounds each statement and memory use, but the whole migration can still create
a long-running transaction on a very large installation. Schedule it in a low-write
window and measure on a production-sized clone first. Dimension changes (for example a
popular game's aliases) synchronously refresh all affected products, so large catalog
edits should also be monitored.

`ALTER TABLE categories ADD COLUMN aliases` takes a brief `ACCESS EXCLUSIVE` DDL lock
(PostgreSQL 16 uses a metadata-only constant default, so it does not rewrite category
rows). Trigger creation also takes a short table lock, and the six catalog-alias
backfill rows take ordinary row locks. Set deployment lock/statement timeouts according
to the site's normal migration policy and retry the release rather than waiting behind a
long-running transaction.

Rollback order:

1. deploy the previous API version, which does not reference the search tables;
2. if database rollback is required, run one migration down;
3. verify the old product search endpoint.

Down removes the search tables, triggers, functions, and `categories.aliases`.
`pg_trgm`/`unaccent` remain because other objects may depend on them. Backfilled
`games.aliases` also remain: deleting catalog data during rollback would overwrite
possible administrator edits. Reapplying the migration is idempotent for those aliases.

## Integration and migration checks

The required product queries are covered by
`backend/test/marketplace-search.test.ts`:

```text
контр страйк
counter strike
cs2
кс2
valorant
валик
roblox
роблокс
аккаунт
акаунт
boost
буст
```

The same suite verifies deterministic tier ordering, typo matching, suggestion results,
all joined document fields, product/dimension trigger refreshes, extensions, indexes,
and triggers.

## Local 20k EXPLAIN evidence

Captured on 2026-07-24 with PostgreSQL 16.14 in the repository's local Docker
environment:

```powershell
$env:SEARCH_BENCH_DATABASE_URL = `
  'postgres://marketplace:marketplace@localhost:5432/skrynia_search_bench'
npx.cmd tsx scripts/search-load-explain.ts --products=20000
```

The safety guard accepts only a local host and a database name ending in `_test` or
`_search_bench`. The fixture uses 20,000 active products, creates 20,000 documents and
429,991 normalized terms, runs `ANALYZE`, records JSON `EXPLAIN (ANALYZE, BUFFERS)`,
and deletes the benchmark seller/products unless `--keep` is passed.

| Profile | Query | Planning | Execution | Scan rows* | Search indexes | Sequential scans |
| --- | --- | ---: | ---: | ---: | --- | --- |
| Short | `cs2` | 3.071 ms | 79.633 ms | 125,001 | title prefix, game name/aliases, category aliases, trigram terms, FTS, document PK | search documents, products, users |
| Typo | `valroant` | 0.658 ms | 80.546 ms | 105,006 | title prefix, game name/aliases, category aliases, trigram terms, FTS, document PK | search documents, products, users |
| Common | `account` | 0.616 ms | 131.799 ms | 160,001 | title prefix, game name/aliases, category aliases, trigram terms, FTS, document PK | search documents, products, users |

\* `Scan rows` is the harness's sum of `Actual Rows × Actual Loops` across plan nodes
whose node type contains `Scan`; it is not the number of distinct heap rows.

The search-specific candidate branches used their indexes in all three plans.
Sequential scans were still selected for the document/product join because this
fixture intentionally makes each query match a broad fraction of 20,000 products
(roughly one of four product families), and `users` contains one benchmark seller. The
common query is consequently the slowest. This final run was cache-warm
(`Shared Read Blocks = 0` for all three plans). These local numbers are evidence of
current planner behaviour, not a production latency SLO or a claim of unbounded
scalability. Production-like data distribution and hardware must be measured before
rollout.
