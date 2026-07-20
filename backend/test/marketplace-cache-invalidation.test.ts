import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { cacheGet, getRedis } from "../src/common/redis.js";
import { pool } from "../src/db/pool.js";
import { issueSession } from "../src/modules/auth/session.service.js";
import { lockEscrow, releaseEscrow } from "../src/modules/orders/ledger.service.js";
import { processOutboxBatch } from "../src/modules/outbox/outbox.worker.js";
import {
  closeDb,
  createOrder,
  createUser,
  resetDb
} from "./fixtures.js";

const app = createApp();

async function drainOutbox() {
  while (true) {
    const result = await processOutboxBatch({
      workerId: "marketplace-cache-test"
    });
    if (result.claimed === 0) return;
  }
}

beforeEach(resetDb);
afterAll(async () => {
  await getRedis()?.quit();
  await closeDb();
});

type Role = "user" | "moderator" | "admin";

async function clientFor(userId: string, role: Role) {
  const session = await issueSession(userId, role);
  const cookie = [`access_token=${session.accessToken}`, `csrf_token=${session.csrfToken}`];
  return {
    userId,
    get: (path: string) => request(app).get(path).set("Cookie", cookie),
    post: (path: string) =>
      request(app).post(path).set("Cookie", cookie).set("X-CSRF-Token", session.csrfToken),
    patch: (path: string) =>
      request(app).patch(path).set("Cookie", cookie).set("X-CSRF-Token", session.csrfToken),
    delete: (path: string) =>
      request(app).delete(path).set("Cookie", cookie).set("X-CSRF-Token", session.csrfToken)
  };
}

async function verifiedSellerClient() {
  const userId = await createUser("user");
  await pool.query(`update users set email_verified_at = now() where id = $1`, [userId]);
  return clientFor(userId, "user");
}

async function adminClient() {
  const userId = await createUser("admin");
  return clientFor(userId, "admin");
}

async function anyCategoryId() {
  const result = await pool.query<{ id: string }>(`select id from categories order by id limit 1`);
  return result.rows[0].id;
}

function listingBody(categoryId: string, overrides: Record<string, unknown> = {}) {
  return {
    categoryId,
    title: `Cache listing ${randomUUID().slice(0, 8)}`,
    description: "A cache invalidation integration test listing.",
    price: "10.00",
    currency: "UAH",
    stock: 5,
    deliveryType: "manual",
    ...overrides
  };
}

async function createListing(
  seller: Awaited<ReturnType<typeof verifiedSellerClient>>,
  categoryId: string,
  overrides: Record<string, unknown> = {}
) {
  const response = await seller.post("/marketplace/products").send(listingBody(categoryId, overrides));
  expect(response.status).toBe(201);
  return response.body.id as string;
}

function categoryCount(response: request.Response, categoryId: string) {
  const category = response.body.categories.find((row: { id: string }) => row.id === categoryId);
  expect(category).toBeDefined();
  return category.activeProductCount as number;
}

describe("marketplace cache invalidation", () => {
  it("hides a cached product after durable admin-block delivery while preserving owner preview", async () => {
    const seller = await verifiedSellerClient();
    const admin = await adminClient();
    const productId = await createListing(seller, await anyCategoryId());

    const warm = await request(app).get(`/marketplace/products/${productId}`);
    expect(warm.status).toBe(200);
    expect(await cacheGet(`marketplace:product:${productId}`)).not.toBeNull();

    const blocked = await admin.patch(`/admin/listings/${productId}`).send({ status: "blocked" });
    expect(blocked.status).toBe(200);
    await drainOutbox();
    expect(await cacheGet(`marketplace:product:${productId}`)).toBeNull();

    expect((await request(app).get(`/marketplace/products/${productId}`)).status).toBe(404);
    const ownerPreview = await seller.get(`/marketplace/products/${productId}`);
    expect(ownerPreview.status).toBe(200);
    expect(ownerPreview.body.product.status).toBe("blocked");
  });

  it("invalidates detail, list, and counters when a seller is banned and unbanned", async () => {
    const seller = await verifiedSellerClient();
    const admin = await adminClient();
    const categoryId = await anyCategoryId();
    const title = `Ban cache ${randomUUID().slice(0, 8)}`;
    const productId = await createListing(seller, categoryId, { title });
    const listPath = `/marketplace/products?q=${encodeURIComponent(title)}`;

    expect((await request(app).get(`/marketplace/products/${productId}`)).status).toBe(200);
    expect((await request(app).get(listPath)).body.products.map((row: { id: string }) => row.id)).toContain(productId);
    expect(categoryCount(await request(app).get("/marketplace/categories"), categoryId)).toBe(1);

    const banned = await admin.patch(`/admin/users/${seller.userId}`).send({ isBanned: true });
    expect(banned.status).toBe(200);
    await drainOutbox();
    expect((await request(app).get(`/marketplace/products/${productId}`)).status).toBe(404);
    expect((await request(app).get(listPath)).body.products).toHaveLength(0);
    expect(categoryCount(await request(app).get("/marketplace/categories"), categoryId)).toBe(0);

    const unbanned = await admin.patch(`/admin/users/${seller.userId}`).send({ isBanned: false });
    expect(unbanned.status).toBe(200);
    expect((await request(app).get(listPath)).body.products.map((row: { id: string }) => row.id)).toContain(productId);
    expect(categoryCount(await request(app).get("/marketplace/categories"), categoryId)).toBe(1);
  });

  it("refreshes cached category counts after create, delete, and block", async () => {
    const seller = await verifiedSellerClient();
    const admin = await adminClient();
    const categoryId = await anyCategoryId();

    const firstId = await createListing(seller, categoryId);
    expect(categoryCount(await request(app).get("/marketplace/categories"), categoryId)).toBe(1);
    expect(await cacheGet("categories")).not.toBeNull();

    const secondId = await createListing(seller, categoryId);
    expect(categoryCount(await request(app).get("/marketplace/categories"), categoryId)).toBe(2);

    expect((await seller.delete(`/marketplace/products/${secondId}`)).status).toBe(204);
    expect(categoryCount(await request(app).get("/marketplace/categories"), categoryId)).toBe(1);

    expect((await admin.patch(`/admin/listings/${firstId}`).send({ status: "blocked" })).status).toBe(200);
    await drainOutbox();
    expect(categoryCount(await request(app).get("/marketplace/categories"), categoryId)).toBe(0);
  });

  it("removes rejected media from an already cached product detail", async () => {
    const seller = await verifiedSellerClient();
    const admin = await adminClient();
    const mediaUrl = `https://cdn.test/${randomUUID()}.webp`;
    const productId = await createListing(seller, await anyCategoryId());
    await pool.query(
      `insert into product_media(product_id, url, sort_order)
       values ($1, $2, 0)`,
      [productId, mediaUrl]
    );
    const media = await pool.query<{ id: string }>(
      `select id from product_media where product_id = $1`,
      [productId]
    );

    const warm = await request(app).get(`/marketplace/products/${productId}`);
    expect(warm.body.product.media.map((row: { url: string }) => row.url)).toContain(mediaUrl);

    const moderated = await admin.patch(`/admin/media/${media.rows[0].id}`).send({ status: "rejected" });
    expect(moderated.status).toBe(200);
    const refreshed = await request(app).get(`/marketplace/products/${productId}`);
    expect(refreshed.body.product.media).toHaveLength(0);
  });

  it("refreshes cached stock after payment and sales count after release", async () => {
    const seller = await verifiedSellerClient();
    const buyerId = await createUser("user");
    const productId = await createListing(seller, await anyCategoryId());
    const orderId = await createOrder(buyerId, seller.userId, productId, {
      amountCents: 1000,
      quantity: 1
    });

    const initial = await request(app).get(`/marketplace/products/${productId}`);
    expect(initial.body.product.stock).toBe(5);
    expect(initial.body.product.salesCount).toBe(0);

    await lockEscrow(orderId, buyerId, "mock");
    const afterPayment = await request(app).get(`/marketplace/products/${productId}`);
    expect(afterPayment.body.product.stock).toBe(4);

    await pool.query(`update orders set status = 'delivered' where id = $1`, [orderId]);
    await releaseEscrow(orderId);
    await drainOutbox();
    const afterRelease = await request(app).get(`/marketplace/products/${productId}`);
    expect(afterRelease.body.product.salesCount).toBe(1);
  });
});
