import pg from "pg";
import {
  buildMarketplaceSearchCtes,
  MARKETPLACE_SEARCH_JOIN
} from "../src/modules/marketplace/marketplace-search.sql.js";

type ExplainNode = {
  "Node Type"?: string;
  "Relation Name"?: string;
  "Index Name"?: string;
  "Actual Rows"?: number;
  "Actual Loops"?: number;
  "Shared Hit Blocks"?: number;
  "Shared Read Blocks"?: number;
  Plans?: ExplainNode[];
};

type ExplainRoot = {
  Plan: ExplainNode;
  "Planning Time": number;
  "Execution Time": number;
};

function argument(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function assertSafeBenchmarkDatabase(connectionString: string) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Search benchmark refuses NODE_ENV=production");
  }

  const url = new URL(connectionString);
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  if (!localHosts.has(url.hostname)) {
    throw new Error(
      `Search benchmark only accepts a local PostgreSQL host; received ${url.hostname}`
    );
  }
  if (!/(_test|_search_bench)$/.test(databaseName)) {
    throw new Error(
      "Search benchmark database name must end in _test or _search_bench"
    );
  }
  return databaseName;
}

function collectPlanEvidence(root: ExplainRoot) {
  const indexes = new Set<string>();
  const sequentialScans = new Set<string>();
  let rowsScanned = 0;
  let sharedHitBlocks = 0;
  let sharedReadBlocks = 0;

  const visit = (node: ExplainNode) => {
    const nodeType = node["Node Type"] ?? "";
    if (node["Index Name"]) indexes.add(node["Index Name"]);
    if (nodeType === "Seq Scan" && node["Relation Name"]) {
      sequentialScans.add(node["Relation Name"]);
    }
    if (nodeType.includes("Scan")) {
      rowsScanned += (node["Actual Rows"] ?? 0) * (node["Actual Loops"] ?? 1);
    }
    sharedHitBlocks += node["Shared Hit Blocks"] ?? 0;
    sharedReadBlocks += node["Shared Read Blocks"] ?? 0;
    for (const child of node.Plans ?? []) visit(child);
  };
  visit(root.Plan);

  return {
    planningMs: root["Planning Time"],
    executionMs: root["Execution Time"],
    rowsScanned,
    indexes: [...indexes].sort(),
    sequentialScans: [...sequentialScans].sort(),
    sharedHitBlocks,
    sharedReadBlocks
  };
}

const connectionString = process.env.SEARCH_BENCH_DATABASE_URL;
if (!connectionString) {
  throw new Error("SEARCH_BENCH_DATABASE_URL is required");
}
const databaseName = assertSafeBenchmarkDatabase(connectionString);
const requestedCount = Number(argument("products") ?? "20000");
if (!Number.isSafeInteger(requestedCount) || requestedCount < 10_000) {
  throw new Error("--products must be an integer of at least 10000");
}
const keepFixture = process.argv.includes("--keep");

const client = new pg.Client({ connectionString });
const benchmarkEmail = "stage13-search-benchmark@local.invalid";
const batchSize = 1_000;
let sellerId: string | null = null;
let replicationRoleReplica = false;

await client.connect();
try {
  const requiredObjects = await client.query<{ object_name: string }>(
    `select extname as object_name
     from pg_extension
     where extname in ('pg_trgm', 'unaccent')
     union all
     select 'marketplace_product_search_documents'
     where to_regclass('public.marketplace_product_search_documents') is not null
     union all
     select 'marketplace_product_search_terms'
     where to_regclass('public.marketplace_product_search_terms') is not null`
  );
  if (requiredObjects.rows.length !== 4) {
    throw new Error(
      "Stage 13 migration (pg_trgm, unaccent, documents, terms) must be applied first"
    );
  }

  await client.query(`delete from users where email = $1`, [benchmarkEmail]);
  sellerId = (
    await client.query<{ id: string }>(
      `insert into users(email, display_name, role)
       values ($1, 'Stage 13 Search Benchmark', 'user')
       returning id`,
      [benchmarkEmail]
    )
  ).rows[0].id;

  const categories = await client.query<{ slug: string; id: string }>(
    `select slug, id
     from categories
     where slug in ('accounts', 'boosting', 'games', 'digital-services')`
  );
  const games = await client.query<{ slug: string; id: string }>(
    `select slug, id
     from games
     where slug in ('cs2', 'valorant', 'roblox', 'dota-2')`
  );
  const categoryIds = new Map(categories.rows.map((row) => [row.slug, row.id]));
  const gameIds = new Map(games.rows.map((row) => [row.slug, row.id]));
  for (const key of ["accounts", "boosting", "games", "digital-services"]) {
    if (!categoryIds.has(key)) throw new Error(`Missing category ${key}`);
  }
  for (const key of ["cs2", "valorant", "roblox", "dota-2"]) {
    if (!gameIds.has(key)) throw new Error(`Missing game ${key}`);
  }

  // This harness is restricted to a disposable local benchmark database. Loading tens
  // of thousands of rows through a per-row maintenance trigger measures fixture setup,
  // not search. Suppress triggers for this session only, then exercise the repository's
  // same bounded refresh function in 1,000-row batches before running EXPLAIN.
  await client.query("set session_replication_role = replica");
  replicationRoleReplica = true;
  for (let offset = 0; offset < requestedCount; offset += batchSize) {
    const count = Math.min(batchSize, requestedCount - offset);
    await client.query(
      `insert into products(
         seller_id, category_id, game_id, title, description, price_cents,
         currency, stock, delivery_type, product_type, server, platform,
         sales_count, status, created_at
       )
       select
         $1::uuid,
         case generated.number % 4
           when 0 then $2::uuid
           when 1 then $3::uuid
           when 2 then $4::uuid
           else $5::uuid
         end,
         case generated.number % 4
           when 0 then $6::uuid
           when 1 then $7::uuid
           when 2 then $8::uuid
           else $9::uuid
         end,
         case generated.number % 4
           when 0 then 'CS2 account offer ' || generated.number
           when 1 then 'Valorant boost service ' || generated.number
           when 2 then 'Roblox item bundle ' || generated.number
           else 'Dota coaching package ' || generated.number
         end,
         case generated.number % 4
           when 0 then 'Secure account handover with prime inventory and support'
           when 1 then 'Rank progression boost with reports and scheduling'
           when 2 then 'Digital item package with safe delivery'
           else 'Competitive coaching service with replay analysis'
         end,
         1000 + (generated.number % 500000),
         'UAH',
         1 + (generated.number % 10),
         'manual',
         case generated.number % 4
           when 0 then 'account'
           when 1 then 'boosting'
           when 2 then 'item'
           else 'service'
         end,
         case generated.number % 3
           when 0 then 'EU'
           when 1 then 'NA'
           else 'Global'
         end,
         case generated.number % 3
           when 0 then 'PC'
           when 1 then 'Mobile'
           else 'Console'
         end,
         (generated.number * 37) % 5000,
         'active',
         now() - make_interval(secs => generated.number % 2592000)
       from generate_series($10::int, $11::int) as generated(number)`,
      [
        sellerId,
        categoryIds.get("accounts"),
        categoryIds.get("boosting"),
        categoryIds.get("games"),
        categoryIds.get("digital-services"),
        gameIds.get("cs2"),
        gameIds.get("valorant"),
        gameIds.get("roblox"),
        gameIds.get("dota-2"),
        offset + 1,
        offset + count
      ]
    );
    process.stderr.write(
      `seeded ${Math.min(offset + count, requestedCount)}/${requestedCount}\r`
    );
  }
  process.stderr.write("\n");
  await client.query("set session_replication_role = origin");
  replicationRoleReplica = false;

  let lastProductId: string | null = null;
  let refreshedCount = 0;
  while (true) {
    const batch = await client.query<{ ids: string[] | null }>(
      `select array_agg(batch.id order by batch.id) as ids
       from (
         select p.id
         from products p
         where p.seller_id = $1
           and ($2::uuid is null or p.id > $2::uuid)
         order by p.id
         limit $3
       ) batch`,
      [sellerId, lastProductId, batchSize]
    );
    const ids = batch.rows[0].ids;
    if (!ids?.length) break;
    await client.query(
      "select marketplace_refresh_product_search_documents($1::uuid[])",
      [ids]
    );
    lastProductId = ids.at(-1) ?? null;
    refreshedCount += ids.length;
    process.stderr.write(
      `refreshed ${Math.min(refreshedCount, requestedCount)}/${requestedCount}\r`
    );
  }
  process.stderr.write("\n");

  await client.query("analyze products");
  await client.query("analyze marketplace_product_search_documents");
  await client.query("analyze marketplace_product_search_terms");

  const counts = await client.query<{
    products: string;
    documents: string;
    terms: string;
  }>(
    `select
       (select count(*) from products where seller_id = $1)::text as products,
       (
         select count(*)
         from marketplace_product_search_documents documents
         join products p on p.id = documents.product_id
         where p.seller_id = $1
       )::text as documents,
       (
         select count(*)
         from marketplace_product_search_terms terms
         join products p on p.id = terms.product_id
         where p.seller_id = $1
       )::text as terms`,
    [sellerId]
  );

  const searchSql = `
    explain (analyze, buffers, format json)
    with ${buildMarketplaceSearchCtes(1)}
    select p.id
    from products p
    ${MARKETPLACE_SEARCH_JOIN}
    join users seller on seller.id = p.seller_id
    where p.status = 'active'
      and p.stock > 0
      and seller.is_banned = false
    order by
      search_match.relevance_tier asc,
      search_match.trigram_similarity desc,
      search_match.full_text_rank desc,
      p.sales_count desc,
      p.created_at desc,
      p.id asc
    limit 20
  `;

  const queries = [
    { kind: "short", query: "cs2" },
    { kind: "typo", query: "valroant" },
    { kind: "common", query: "account" }
  ] as const;
  const evidence: Array<{
    kind: string;
    query: string;
    plan: ReturnType<typeof collectPlanEvidence>;
  }> = [];
  for (const query of queries) {
    const explained = await client.query(searchSql, [query.query]);
    const root = explained.rows[0]["QUERY PLAN"][0] as ExplainRoot;
    evidence.push({
      kind: query.kind,
      query: query.query,
      plan: collectPlanEvidence(root)
    });
  }

  console.log(
    JSON.stringify(
      {
        database: databaseName,
        fixture: {
          requestedProducts: requestedCount,
          products: Number(counts.rows[0].products),
          documents: Number(counts.rows[0].documents),
          terms: Number(counts.rows[0].terms)
        },
        evidence
      },
      null,
      2
    )
  );
} finally {
  if (replicationRoleReplica) {
    await client.query("set session_replication_role = origin");
  }
  if (!keepFixture && sellerId) {
    await client.query(`delete from users where id = $1`, [sellerId]);
  }
  await client.end();
}
