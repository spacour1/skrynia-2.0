import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { cacheDelPrefixes, cacheGet, getRedis } from "../src/common/redis.js";
import { issueSession } from "../src/modules/auth/session.service.js";
import {
  createCatalogGroup,
  createCatalogItem,
  createCatalogSection,
  createSchemaVersion,
  publishCatalogSection,
  publishSchemaVersion
} from "../src/modules/catalog/catalog.service.js";
import { closeDb, createProduct, createUser, resetDb } from "./fixtures.js";

/**
 * Public product detail must expose only active listings from non-banned sellers;
 * the owner and staff keep preview access to their non-public listings.
 */

const app = createApp();

beforeEach(resetDb);
afterAll(async () => {
  await getRedis()?.quit();
  await closeDb();
});

async function cookieFor(userId: string, role: "user" | "moderator" | "admin" = "user") {
  const session = await issueSession(userId, role);
  return [`access_token=${session.accessToken}`, `csrf_token=${session.csrfToken}`];
}

async function setup(status: string, sellerBanned = false) {
  const seller = await createUser("user");
  const productId = await createProduct(seller);
  await pool.query(`update products set status = $2 where id = $1`, [productId, status]);
  if (sellerBanned) await pool.query(`update users set is_banned = true where id = $1`, [seller]);
  return { seller, productId };
}

async function authedClient(userId: string, role: "user" | "admin") {
  const session = await issueSession(userId, role);
  const cookie = [`access_token=${session.accessToken}`, `csrf_token=${session.csrfToken}`];
  return {
    get: (path: string) => request(app).get(path).set("Cookie", cookie),
    put: (path: string) => request(app).put(path).set("Cookie", cookie).set("X-CSRF-Token", session.csrfToken),
    post: (path: string) => request(app).post(path).set("Cookie", cookie).set("X-CSRF-Token", session.csrfToken),
    patch: (path: string) => request(app).patch(path).set("Cookie", cookie).set("X-CSRF-Token", session.csrfToken)
  };
}

async function setupCatalogProduct() {
  const adminId = await createUser("admin");
  const seller = await createUser("user");
  const buyer = await createUser("user");
  await pool.query(`update users set email_verified_at = now() where id = any($1::uuid[])`, [[seller, buyer]]);
  const suffix = randomUUID().slice(0, 8);
  const group = await createCatalogGroup(
    { slug: `visibility-group-${suffix}`, name: `Visibility group ${suffix}`, status: "active" },
    adminId
  );
  const item = await createCatalogItem(
    { groupId: group.id, slug: `visibility-item-${suffix}`, name: `Visibility item ${suffix}`, status: "active" },
    adminId
  );
  const category = await pool.query<{ id: string }>(`select id from categories order by id limit 1`);
  const section = await createCatalogSection(
    {
      itemId: item.id,
      categoryId: category.rows[0].id,
      slug: `visibility-section-${suffix}`,
      name: `Visibility section ${suffix}`,
      listingType: "account",
      status: "draft"
    },
    adminId
  );
  const schema = await createSchemaVersion(section.id, { fields: [] }, adminId);
  await publishSchemaVersion(section.id, schema.id, adminId);
  await publishCatalogSection(section.id, adminId);
  const title = `Visibility product ${suffix}`;
  const productId = await createProduct(seller);
  await pool.query(
    `update products
     set game_id = $2, section_id = $3, schema_version = $4,
         title = $5, description = 'Catalog visibility regression product'
     where id = $1`,
    [productId, item.id, section.id, schema.version, title]
  );
  return {
    admin: await authedClient(adminId, "admin"),
    buyer: await authedClient(buyer, "user"),
    group,
    item,
    section,
    title,
    productId
  };
}

describe("public product visibility", () => {
  it("serves an active product anonymously", async () => {
    const { productId } = await setup("active");
    const response = await request(app).get(`/marketplace/products/${productId}`);
    expect(response.status).toBe(200);
    expect(response.body.product.id).toBe(productId);
    expect(response.body.product.sellerIsBanned).toBeUndefined();
  });

  it.each(["paused", "blocked"])("hides a %s product from anonymous visitors", async (status) => {
    const { productId } = await setup(status);
    const response = await request(app).get(`/marketplace/products/${productId}`);
    expect(response.status).toBe(404);
  });

  it("hides an active product of a banned seller from anonymous visitors", async () => {
    const { productId } = await setup("active", true);
    const response = await request(app).get(`/marketplace/products/${productId}`);
    expect(response.status).toBe(404);
  });

  it("lets the owner preview their paused product", async () => {
    const { seller, productId } = await setup("paused");
    const response = await request(app).get(`/marketplace/products/${productId}`).set("Cookie", await cookieFor(seller));
    expect(response.status).toBe(200);
    expect(response.body.product.status).toBe("paused");
  });

  it("does not let another user open someone else's paused product", async () => {
    const { productId } = await setup("paused");
    const stranger = await createUser("user");
    const response = await request(app).get(`/marketplace/products/${productId}`).set("Cookie", await cookieFor(stranger));
    expect(response.status).toBe(404);
  });

  it("lets a moderator open a blocked product", async () => {
    const { productId } = await setup("blocked");
    const moderator = await createUser("moderator");
    const response = await request(app).get(`/marketplace/products/${productId}`).set("Cookie", await cookieFor(moderator, "moderator"));
    expect(response.status).toBe(200);
  });

  it("does not leak a non-public product through the cache after an owner preview", async () => {
    const { seller, productId } = await setup("paused");
    await request(app).get(`/marketplace/products/${productId}`).set("Cookie", await cookieFor(seller));
    const anonymous = await request(app).get(`/marketplace/products/${productId}`);
    expect(anonymous.status).toBe(404);
  });

  it("rejects retained game and product caches after a catalog hide without Redis invalidation", async () => {
    const context = await setupCatalogProduct();
    const detailPath = `/marketplace/products/${context.productId}`;
    const listPath = `/marketplace/products?q=${encodeURIComponent(context.title)}`;

    const warmGames = await request(app).get("/marketplace/games");
    expect(warmGames.status, warmGames.text).toBe(200);
    expect(warmGames.body.games.map((row: { id: string }) => row.id)).toContain(context.item.id);
    expect((await request(app).get(detailPath)).status).toBe(200);
    const warmList = await request(app).get(listPath);
    expect(warmList.status, warmList.text).toBe(200);
    expect(warmList.body.products.map((row: { id: string }) => row.id)).toContain(context.productId);

    const keys = ["marketplace:games", `marketplace:product:${context.productId}`];
    const retained = await Promise.all(keys.map((key) => cacheGet(key)));
    for (const entry of retained) expect(entry).not.toBeNull();

    // Autocommit bypasses invalidation, modelling a crash between the database
    // commit and Redis cleanup. The unchanged entries must not authorize disclosure.
    await pool.query(`update catalog_groups set status = 'hidden' where id = $1`, [context.group.id]);
    expect(await Promise.all(keys.map((key) => cacheGet(key)))).toEqual(retained);

    const hiddenGames = await request(app).get("/marketplace/games");
    expect(hiddenGames.status, hiddenGames.text).toBe(200);
    expect(hiddenGames.body.games.map((row: { id: string }) => row.id)).not.toContain(context.item.id);
    expect((await request(app).get(detailPath)).status).toBe(404);
    const hiddenList = await request(app).get(listPath);
    expect(hiddenList.status, hiddenList.text).toBe(200);
    expect(hiddenList.body.products.map((row: { id: string }) => row.id)).not.toContain(context.productId);
  });

  it.each(["group", "item", "section"] as const)(
    "removes a catalog product from every public surface when its %s is hidden after cache warmup",
    async (level) => {
      const context = await setupCatalogProduct();
      const encodedTitle = encodeURIComponent(context.title);

      expect((await request(app).get(`/marketplace/products/${context.productId}`)).status).toBe(200);
      expect(
        (await request(app).get(`/marketplace/products?q=${encodedTitle}`)).body.products
          .map((row: { id: string }) => row.id)
      ).toContain(context.productId);
      expect((await context.buyer.put(`/marketplace/favorites/${context.productId}`)).status).toBe(200);

      const target = level === "group" ? context.group : level === "item" ? context.item : context.section;
      const hidden = await context.admin
        .patch(`/admin/catalog/${level}s/${target.id}`)
        .send({ status: "hidden" });
      expect(hidden.status).toBe(200);

      expect((await request(app).get(`/marketplace/products/${context.productId}`)).status).toBe(404);
      expect(
        (await request(app).get(`/marketplace/products?q=${encodedTitle}`)).body.products
          .map((row: { id: string }) => row.id)
      ).not.toContain(context.productId);
      expect(
        (await request(app).get(`/marketplace/suggest?q=${encodedTitle}`)).body.products
          .map((row: { id: string }) => row.id)
      ).not.toContain(context.productId);
      expect(
        (await context.buyer.get("/marketplace/favorites/ids")).body.productIds
      ).not.toContain(context.productId);
      expect(
        (await context.buyer.get("/marketplace/favorites")).body.products
          .map((row: { id: string }) => row.id)
      ).not.toContain(context.productId);
      expect((await context.buyer.put(`/marketplace/favorites/${context.productId}`)).status).toBe(404);
      expect((await context.buyer.post(`/chat/products/${context.productId}/start`)).status).toBe(404);

      const directItem = await request(app).get(`/marketplace/catalog/items/${context.item.slug}`);
      if (level === "section") {
        expect(directItem.status).toBe(200);
        expect(directItem.body.item.sections.map((row: { id: string }) => row.id)).not.toContain(context.section.id);
      } else {
        expect(directItem.status).toBe(404);
      }

      const restored = await context.admin
        .patch(`/admin/catalog/${level}s/${target.id}`)
        .send({ status: "active" });
      expect(restored.status).toBe(200);
      expect((await request(app).get(`/marketplace/products/${context.productId}`)).status).toBe(200);
    }
  );
});

describe("marketplace product keyset pagination", () => {
  it("traverses tied newest/sales/rating/search results and binds cursors to filters", async () => {
    const seller = await createUser("user");
    const productIds: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      productIds.push(await createProduct(seller));
    }
    await pool.query(
      `update products
       set created_at = '2026-07-01T12:00:00.000900Z', sales_count = 3
       where id = any($1::uuid[])`,
      [productIds]
    );
    await cacheDelPrefixes("marketplace:products:");

    for (const query of [
      "sort=newest",
      "sort=sales",
      "sort=rating",
      "q=Test%20product"
    ]) {
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const suffix = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
        const response = await request(app).get(`/marketplace/products?limit=2&${query}${suffix}`);
        expect(response.status, response.text).toBe(200);
        expect(response.body.products[0]).not.toHaveProperty("cursorCreatedAt");
        seen.push(...response.body.products.map((row: { id: string }) => row.id));
        cursor = response.body.nextCursor;
      } while (cursor);

      expect(new Set(seen).size, query).toBe(productIds.length);
      expect([...seen].sort(), query).toEqual([...productIds].sort());
    }

    const first = await request(app).get("/marketplace/products?limit=2&sort=newest");
    expect(first.body.nextCursor).toEqual(expect.any(String));
    const rebound = await request(app).get(
      `/marketplace/products?limit=2&sort=newest&hot=true&cursor=${encodeURIComponent(first.body.nextCursor)}`
    );
    expect(rebound.status).toBe(400);
    expect((await request(app).get("/marketplace/products?limit=2&sort=newest&page=2")).status).toBe(400);
  });
});
