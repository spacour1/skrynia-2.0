import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import {
  cacheDelPrefixes,
  getRedis
} from "../src/common/redis.js";
import { pool } from "../src/db/pool.js";
import { closeDb, createUser, resetDb } from "./fixtures.js";

const app = createApp();

beforeEach(async () => {
  await resetDb();
  await cacheDelPrefixes("marketplace:products:");
});

afterAll(async () => {
  await getRedis()?.quit();
  await closeDb();
});

type SearchFixture = {
  cs2: string;
  valorant: string;
  roblox: string;
  unrelated: string;
};

async function catalogId(table: "categories" | "games", slug: string) {
  const result = await pool.query<{ id: string }>(
    `select id from ${table} where slug = $1`,
    [slug]
  );
  if (!result.rows[0]) throw new Error(`Missing ${table} fixture: ${slug}`);
  return result.rows[0].id;
}

async function insertProduct(input: {
  sellerId: string;
  categorySlug: string;
  gameSlug: string;
  title: string;
  description: string;
  productType: "account" | "boosting" | "service";
  salesCount: number;
}) {
  const categoryId = await catalogId("categories", input.categorySlug);
  const gameId = await catalogId("games", input.gameSlug);
  const result = await pool.query<{ id: string }>(
    `insert into products(
       seller_id, category_id, game_id, title, description, price_cents,
       currency, stock, delivery_type, product_type, sales_count, status
     )
     values ($1, $2, $3, $4, $5, 1000, 'UAH', 5, 'manual', $6, $7, 'active')
     returning id`,
    [
      input.sellerId,
      categoryId,
      gameId,
      input.title,
      input.description,
      input.productType,
      input.salesCount
    ]
  );
  return result.rows[0].id;
}

async function createMandatoryFixtures(): Promise<SearchFixture> {
  const sellerId = await createUser();
  return {
    cs2: await insertProduct({
      sellerId,
      categorySlug: "accounts",
      gameSlug: "cs2",
      title: "Аккаунт CS2 Prime",
      description: "Prime account with inventory and transfer support",
      productType: "account",
      salesCount: 500
    }),
    valorant: await insertProduct({
      sellerId,
      categorySlug: "boosting",
      gameSlug: "valorant",
      title: "Valorant rank boost",
      description: "Competitive rank progression with reports",
      productType: "boosting",
      salesCount: 300
    }),
    roblox: await insertProduct({
      sellerId,
      categorySlug: "accounts",
      gameSlug: "roblox",
      title: "Roblox premium account",
      description: "Premium profile with safe handover",
      productType: "account",
      salesCount: 100
    }),
    unrelated: await insertProduct({
      sellerId,
      categorySlug: "digital-services",
      gameSlug: "dota-2",
      title: "Unrelated marketplace service",
      description: "Popular but intentionally irrelevant listing",
      productType: "service",
      salesCount: 1_000_000
    })
  };
}

async function firstProductId(query: string) {
  const response = await request(app)
    .get("/marketplace/products")
    .query({ q: query, limit: 10 });
  expect(response.status).toBe(200);
  expect(response.body.products.length).toBeGreaterThan(0);
  return response.body.products[0].id as string;
}

describe("multilingual marketplace product search", () => {
  it.each([
    ["контр страйк", "cs2"],
    ["counter strike", "cs2"],
    ["cs2", "cs2"],
    ["кс2", "cs2"],
    ["valorant", "valorant"],
    ["валик", "valorant"],
    ["roblox", "roblox"],
    ["роблокс", "roblox"],
    ["аккаунт", "cs2"],
    ["акаунт", "cs2"],
    ["boost", "valorant"],
    ["буст", "valorant"]
  ] as const)(
    "returns the first relevant fixture for %s",
    async (query, expectedFixture) => {
      const fixtures = await createMandatoryFixtures();
      expect(await firstProductId(query)).toBe(fixtures[expectedFixture]);
    }
  );

  it("keeps exact title, prefix, game alias and game name tiers above popularity", async () => {
    const sellerId = await createUser();
    const categoryId = await catalogId("categories", "digital-services");
    const groupId = (
      await pool.query<{ id: string }>(
        `select id from catalog_groups where slug = 'games'`
      )
    ).rows[0].id;

    const aliasGame = (
      await pool.query<{ id: string }>(
        `insert into games(
           group_id, slug, name, aliases, status, is_active, popularity
         )
         values ($1, $2, 'Alias Game', array['arena'], 'active', true, 1)
         returning id`,
        [groupId, `alias-${randomUUID()}`]
      )
    ).rows[0].id;
    const namedGame = (
      await pool.query<{ id: string }>(
        `insert into games(
           group_id, slug, name, aliases, status, is_active, popularity
         )
         values ($1, $2, 'Arena', '{}', 'active', true, 100000)
         returning id`,
        [groupId, `named-${randomUUID()}`]
      )
    ).rows[0].id;

    const rows = await pool.query<{ id: string }>(
      `insert into products(
         seller_id, category_id, game_id, title, description, price_cents,
         currency, stock, delivery_type, product_type, sales_count, status
       )
       values
         ($1, $2, $3, 'Arena', 'Exact title', 1000, 'UAH', 1, 'manual', 'service', 0, 'active'),
         ($1, $2, $3, 'Arena premium', 'Title prefix', 1000, 'UAH', 1, 'manual', 'service', 1000, 'active'),
         ($1, $2, $3, 'Small alias listing', 'Alias match', 1000, 'UAH', 1, 'manual', 'service', 0, 'active'),
         ($1, $2, $4, 'Very popular named listing', 'Game name match', 1000, 'UAH', 1, 'manual', 'service', 1000000, 'active')
       returning id`,
      [sellerId, categoryId, aliasGame, namedGame]
    );

    const response = await request(app)
      .get("/marketplace/products")
      .query({ q: "arena", limit: 10 });
    expect(response.status).toBe(200);
    expect(response.body.products.slice(0, 4).map((product: { id: string }) => product.id))
      .toEqual(rows.rows.map((row) => row.id));
  });

  it("maintains joined and product-owned search fields through triggers", async () => {
    const adminId = await createUser("admin");
    const sellerId = await createUser();
    const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
    const groupId = (
      await pool.query<{ id: string }>(
        `select id from catalog_groups where slug = 'games'`
      )
    ).rows[0].id;
    const category = (
      await pool.query<{ id: string }>(
        `insert into categories(slug, name, aliases)
         values ($1, $2, array[$3])
         returning id`,
        [`search-category-${suffix}`, `Category ${suffix}`, `catalias${suffix}`]
      )
    ).rows[0];
    const game = (
      await pool.query<{ id: string }>(
        `insert into games(
           group_id, slug, name, aliases, status, is_active
         )
         values ($1, $2, $3, array[$4], 'active', true)
         returning id`,
        [
          groupId,
          `search-game-${suffix}`,
          `Game ${suffix}`,
          `gamealias${suffix}`
        ]
      )
    ).rows[0];
    const section = (
      await pool.query<{ id: string }>(
        `insert into game_sections(
           game_id, category_id, slug, name, product_type, status, is_active
         )
         values ($1, $2, $3, $4, 'service', 'active', true)
         returning id`,
        [
          game.id,
          category.id,
          `search-section-${suffix}`,
          `Section ${suffix}`
        ]
      )
    ).rows[0];
    await pool.query(
      `insert into catalog_section_schemas(
         section_id, version, schema, status, created_by
       )
       values ($1, 1, '{"fields":[]}', 'active', $2)`,
      [section.id, adminId]
    );
    await pool.query(
      `update game_sections set current_schema_version = 1 where id = $1`,
      [section.id]
    );

    const product = (
      await pool.query<{ id: string }>(
        `insert into products(
           seller_id, category_id, game_id, section_id, schema_version,
           title, description, price_cents, currency, stock, delivery_type,
           product_type, server, platform, status
         )
         values (
           $1, $2, $3, $4, 1, $5, $6, 1000, 'UAH', 1, 'manual',
           'service', $7, $8, 'active'
         )
         returning id`,
        [
          sellerId,
          category.id,
          game.id,
          section.id,
          `Title ${suffix}`,
          `Descriptiontoken${suffix}`,
          `Server${suffix}`,
          `Platform${suffix}`
        ]
      )
    ).rows[0];

    for (const query of [
      `title ${suffix}`,
      `descriptiontoken${suffix}`,
      `gamealias${suffix}`,
      `catalias${suffix}`,
      `section ${suffix}`,
      "service",
      `server${suffix}`,
      `platform${suffix}`
    ]) {
      expect(await firstProductId(query)).toBe(product.id);
    }

    const updatedTitle = `Updatedtitle${suffix}`;
    const updatedGameAlias = `updatedgame${suffix}`;
    const updatedCategoryAlias = `updatedcategory${suffix}`;
    const updatedSection = `Updatedsection${suffix}`;
    await pool.query(`update products set title = $2 where id = $1`, [
      product.id,
      updatedTitle
    ]);
    await pool.query(`update games set aliases = array[$2] where id = $1`, [
      game.id,
      updatedGameAlias
    ]);
    await pool.query(`update categories set aliases = array[$2] where id = $1`, [
      category.id,
      updatedCategoryAlias
    ]);
    await pool.query(`update game_sections set name = $2 where id = $1`, [
      section.id,
      updatedSection
    ]);

    for (const query of [
      updatedTitle,
      updatedGameAlias,
      updatedCategoryAlias,
      updatedSection
    ]) {
      expect(await firstProductId(query)).toBe(product.id);
    }
  });

  it("uses trigram terms for a single-token typo", async () => {
    const fixtures = await createMandatoryFixtures();
    expect(await firstProductId("valroant")).toBe(fixtures.valorant);
  });

  it("rejects punctuation-only search instead of normalizing it to a match-all prefix", async () => {
    const response = await request(app)
      .get("/marketplace/products")
      .query({ q: "---" });
    expect(response.status).toBe(400);
  });
});

describe("multilingual suggestions and schema", () => {
  it("suggests games and products through catalog aliases and typo matching", async () => {
    const fixtures = await createMandatoryFixtures();

    const aliasResponse = await request(app)
      .get("/marketplace/suggest")
      .query({ q: "валик" });
    expect(aliasResponse.status).toBe(200);
    expect(aliasResponse.body.games[0].slug).toBe("valorant");
    expect(aliasResponse.body.products[0].id).toBe(fixtures.valorant);

    const typoResponse = await request(app)
      .get("/marketplace/suggest")
      .query({ q: "valroant" });
    expect(typoResponse.status).toBe(200);
    expect(typoResponse.body.games[0].slug).toBe("valorant");
    expect(typoResponse.body.products[0].id).toBe(fixtures.valorant);
  });

  it("installs extensions, indexes, triggers and the denormalized representation", async () => {
    const extensions = await pool.query<{ extname: string }>(
      `select extname from pg_extension where extname in ('pg_trgm', 'unaccent')
       order by extname`
    );
    expect(extensions.rows.map((row) => row.extname)).toEqual([
      "pg_trgm",
      "unaccent"
    ]);

    const indexes = await pool.query<{ indexname: string }>(
      `select indexname
       from pg_indexes
       where schemaname = 'public'
         and indexname in (
           'marketplace_search_title_prefix_idx',
           'marketplace_search_game_aliases_idx',
           'marketplace_search_category_aliases_idx',
           'marketplace_search_document_fts_idx',
           'marketplace_search_term_trgm_idx'
         )
       order by indexname`
    );
    expect(indexes.rows).toHaveLength(5);

    const triggers = await pool.query<{ tgname: string }>(
      `select tgname
       from pg_trigger
       where not tgisinternal
         and tgname like 'trg_marketplace_product_search_%'`
    );
    expect(triggers.rows).toHaveLength(4);
  });
});
