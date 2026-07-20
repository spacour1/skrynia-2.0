import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.js";
import { getRedis } from "../src/common/redis.js";
import {
  CATALOG_SCHEMA_STATUSES,
  CATALOG_STATUSES,
  DELIVERY_TYPES,
  DISPUTE_DECISIONS,
  DISPUTE_STATUSES,
  MESSAGE_KINDS,
  ORDER_STATUSES,
  PRODUCT_STATUSES,
  PRODUCT_TYPES,
  ROLES,
  isOrderStatus
} from "../src/domain/enums.js";
import { platformFeeCents } from "../src/domain/money.js";
import { createCatalogSection } from "../src/modules/catalog/catalog-sections.service.js";
import { closeDb, createOrder, createProduct, createUser, resetDb } from "./fixtures.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

beforeEach(resetDb);
afterAll(async () => {
  await getRedis()?.quit();
  await closeDb();
});

/**
 * Extracts the literal IN-list of a CHECK constraint (`col = ANY (ARRAY['a', 'b'])`)
 * so each canonical enum below is compared with the exact set the database enforces.
 */
async function checkInListLiterals(table: string, column: string): Promise<string[]> {
  const result = await pool.query<{ def: string }>(
    `select pg_get_constraintdef(oid) as def
     from pg_constraint
     where conrelid = $1::regclass and contype = 'c'`,
    [table]
  );
  for (const row of result.rows) {
    const match = row.def.match(new RegExp(`${column}\\s*=\\s*ANY\\s*\\(ARRAY\\[([^\\]]*)\\]`));
    if (match) {
      return [...match[1].matchAll(/'([^']*)'/g)].map((m) => m[1]).sort();
    }
  }
  throw new Error(`No IN-list CHECK constraint found for ${table}.${column}`);
}

async function checkSubsetLiterals(table: string, column: string): Promise<string[]> {
  const result = await pool.query<{ def: string }>(
    `select pg_get_constraintdef(oid) as def
     from pg_constraint
     where conrelid = $1::regclass and contype = 'c'`,
    [table]
  );
  for (const row of result.rows) {
    const match = row.def.match(new RegExp(`${column}\\s*<@\\s*ARRAY\\[([^\\]]*)\\]`));
    if (match) {
      return [...match[1].matchAll(/'([^']*)'/g)].map((m) => m[1]).sort();
    }
  }
  throw new Error(`No subset CHECK constraint found for ${table}.${column}`);
}

const sorted = (values: readonly string[]) => [...values].sort();

describe("database constraints match canonical enums", () => {
  it("orders.status", async () => {
    expect(await checkInListLiterals("orders", "status")).toEqual(sorted(ORDER_STATUSES));
  });

  it("products.status", async () => {
    expect(await checkInListLiterals("products", "status")).toEqual(sorted(PRODUCT_STATUSES));
  });

  it("products.delivery_type", async () => {
    expect(await checkInListLiterals("products", "delivery_type")).toEqual(sorted(DELIVERY_TYPES));
  });

  it("products.product_type", async () => {
    expect(await checkInListLiterals("products", "product_type")).toEqual(sorted(PRODUCT_TYPES));
  });

  it("disputes.status", async () => {
    expect(await checkInListLiterals("disputes", "status")).toEqual(sorted(DISPUTE_STATUSES));
  });

  it("disputes.resolution", async () => {
    expect(await checkInListLiterals("disputes", "resolution")).toEqual(sorted(DISPUTE_DECISIONS));
  });

  it("users.role", async () => {
    expect(await checkInListLiterals("users", "role")).toEqual(sorted(ROLES));
  });

  it("messages.kind", async () => {
    expect(await checkInListLiterals("messages", "kind")).toEqual(sorted(MESSAGE_KINDS));
  });

  it("catalog_groups/games/game_sections lifecycle", async () => {
    expect(await checkInListLiterals("catalog_groups", "status")).toEqual(sorted(CATALOG_STATUSES));
    expect(await checkInListLiterals("games", "status")).toEqual(sorted(CATALOG_STATUSES));
    expect(await checkInListLiterals("game_sections", "status")).toEqual(sorted(CATALOG_STATUSES));
  });

  it("catalog_section_schemas.status keeps its distinct lifecycle", async () => {
    expect(await checkInListLiterals("catalog_section_schemas", "status")).toEqual(
      sorted(CATALOG_SCHEMA_STATUSES)
    );
  });

  it("game_sections.allowed_delivery_types no longer admits 'service'", async () => {
    expect(await checkSubsetLiterals("game_sections", "allowed_delivery_types")).toEqual(
      sorted(DELIVERY_TYPES)
    );
  });
});

describe("order status round-trip", () => {
  it("every canonical status inserts and unknown statuses are rejected", async () => {
    const buyer = await createUser();
    const seller = await createUser();
    const product = await createProduct(seller);

    for (const status of ORDER_STATUSES) {
      const orderId = await createOrder(buyer, seller, product, { status });
      const row = await pool.query<{ status: string }>(`select status from orders where id = $1`, [orderId]);
      expect(row.rows[0].status).toBe(status);
      expect(isOrderStatus(row.rows[0].status)).toBe(true);
    }

    await expect(createOrder(buyer, seller, product, { status: "created" })).rejects.toThrow(
      /orders_status_check/
    );
    expect(isOrderStatus("created")).toBe(false);
  });
});

describe("delivery type reconciliation", () => {
  async function catalogFixtures() {
    const admin = await createUser("admin");
    const game = await pool.query<{ id: string }>(
      `insert into games(slug, name) values ($1, 'Invariant Game') returning id`,
      [`invariant-game-${randomUUID().slice(0, 8)}`]
    );
    const category = await pool.query<{ id: string }>(`select id from categories limit 1`);
    return { admin, gameId: game.rows[0].id, categoryId: category.rows[0].id };
  }

  it("rejects 'service' as a section delivery type at the database level", async () => {
    const { gameId, categoryId } = await catalogFixtures();
    await expect(
      pool.query(
        `insert into game_sections(game_id, category_id, slug, name, allowed_delivery_types)
         values ($1, $2, 'svc-section', 'Svc', '{service}')`,
        [gameId, categoryId]
      )
    ).rejects.toThrow(/game_sections_allowed_delivery_types_check/);
  });

  it("rejects an empty delivery type list at the database level", async () => {
    const { gameId, categoryId } = await catalogFixtures();
    await expect(
      pool.query(
        `insert into game_sections(game_id, category_id, slug, name, allowed_delivery_types)
         values ($1, $2, 'empty-section', 'Empty', '{}')`,
        [gameId, categoryId]
      )
    ).rejects.toThrow(/game_sections_allowed_delivery_types_check/);
  });

  it("rejects 'service' and empty lists in the catalog section service", async () => {
    const { admin, gameId, categoryId } = await catalogFixtures();
    await expect(
      createCatalogSection(
        { itemId: gameId, categoryId, slug: "svc-api", name: "Svc", allowedDeliveryTypes: ["service"] },
        admin
      )
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      createCatalogSection(
        { itemId: gameId, categoryId, slug: "empty-api", name: "Empty", allowedDeliveryTypes: [] },
        admin
      )
    ).rejects.toMatchObject({ status: 400 });
  });

  it("still accepts manual/instant sections", async () => {
    const { admin, gameId, categoryId } = await catalogFixtures();
    const section = await createCatalogSection(
      { itemId: gameId, categoryId, slug: "ok-api", name: "Ok", allowedDeliveryTypes: ["manual", "instant"] },
      admin
    );
    expect(section.allowedDeliveryTypes).toEqual(["manual", "instant"]);
  });
});

describe("platform fee rule", () => {
  it("floors, never rounds up", () => {
    expect(platformFeeCents(2000, 1000)).toBe(200);
    expect(platformFeeCents(999, 1000)).toBe(99); // 99.9 floors to 99
    expect(platformFeeCents(1, 999)).toBe(0);
    expect(platformFeeCents(0, 1000)).toBe(0);
    expect(platformFeeCents(10_001, 1)).toBe(1); // 1.0001 floors to 1
  });

  it("is exact for amounts where float math would lose integer precision", () => {
    const amount = 9_007_199_254_740_991n; // Number.MAX_SAFE_INTEGER as cents
    const expected = Number((amount * 999n) / 10_000n);
    expect(platformFeeCents(amount, 999)).toBe(expected);
  });

  it("rejects unsafe or invalid input", () => {
    expect(() => platformFeeCents(0.5, 1000)).toThrow(/safe integer/);
    expect(() => platformFeeCents(-1, 1000)).toThrow(/non-negative/);
    expect(() => platformFeeCents(1000, -1)).toThrow(/between 0 and 10000/);
    expect(() => platformFeeCents(1000, 10_001)).toThrow(/between 0 and 10000/);
    expect(() => platformFeeCents(1000, 2.5)).toThrow(/between 0 and 10000/);
  });
});

describe("documentation agrees with the schema", () => {
  const read = (relative: string) => fs.readFileSync(path.join(repoRoot, relative), "utf8");

  it("no document claims a 'created' order status", () => {
    for (const file of ["docs/product-behavior.md", "AGENTS.md", "docs/domain-invariants.md"]) {
      const text = read(file);
      expect(text, `${file} must not describe a 'created' order status`).not.toMatch(
        /`created`\s+status|status\s+`created`|Order starts in `created`|created\s*(→|->)\s*paid/
      );
    }
  });

  it("the fee rule is documented as floor, not ceil", () => {
    const text = read("docs/product-behavior.md");
    expect(text).not.toMatch(/ceil\(amount/);
    expect(text).toMatch(/floor\(amount/);
  });

  it("wallet docs reference the real wallet columns", () => {
    const text = read("docs/product-behavior.md");
    expect(text).not.toMatch(/wallets\.balance_cents/);
    expect(text).toMatch(/available_cents/);
  });
});
