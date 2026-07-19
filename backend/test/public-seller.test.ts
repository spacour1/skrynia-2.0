import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { cacheDel, cacheDelPrefixes, getRedis } from "../src/common/redis.js";
import {
  closeDb,
  createOrder,
  createProduct,
  createUser,
  resetDb
} from "./fixtures.js";

const app = createApp();

beforeEach(resetDb);
afterAll(async () => {
  await getRedis()?.quit();
  await closeDb();
});

describe("public seller profile", () => {
  it("returns only the explicit PublicSellerDto and no private account fields", async () => {
    const sellerId = await createUser("user");
    const privateValue = "must-never-be-public";
    await pool.query(
      `update users
       set display_name = 'Public Seller',
           avatar_url = 'https://cdn.test/avatar.webp',
           phone = '+380501234567',
           push_enabled = true,
           settings = $2,
           preferred_locale = 'en'
       where id = $1`,
      [sellerId, { privateValue, notificationEmail: true }]
    );

    const response = await request(app).get(`/users/${sellerId}`);

    expect(response.status).toBe(200);
    expect(Object.keys(response.body.user).sort()).toEqual(
      ["avatarUrl", "createdAt", "displayName", "id", "online", "ratingAverage", "reviewCount"].sort()
    );
    expect(response.body.user).toMatchObject({
      id: sellerId,
      displayName: "Public Seller",
      avatarUrl: "https://cdn.test/avatar.webp",
      ratingAverage: 0,
      reviewCount: 0,
      online: false
    });
    expect(typeof response.body.user.createdAt).toBe("string");
    expect(JSON.stringify(response.body.user)).not.toContain(privateValue);
    expect(response.body.user).not.toHaveProperty("settings");
    expect(response.body.user).not.toHaveProperty("email");
    expect(response.body.user).not.toHaveProperty("phone");
    expect(response.body.user).not.toHaveProperty("role");
    expect(response.body.user).not.toHaveProperty("pushEnabled");
  });

  it("calculates independent seller aggregates without join multiplication", async () => {
    const sellerId = await createUser("user");
    const buyerA = await createUser("user");
    const buyerB = await createUser("user");
    const productA = await createProduct(sellerId);
    const productB = await createProduct(sellerId);
    await pool.query(`update products set sales_count = 2 where id = $1`, [productA]);
    await pool.query(`update products set sales_count = 3 where id = $1`, [productB]);

    await pool.query(
      `insert into product_favorites(user_id, product_id)
       values ($1, $3), ($1, $4), ($2, $3)`,
      [buyerA, buyerB, productA, productB]
    );

    const completedA = await createOrder(buyerA, sellerId, productA, { status: "completed", amountCents: 1000 });
    const completedB = await createOrder(buyerB, sellerId, productB, { status: "completed", amountCents: 2000 });
    await createOrder(buyerA, sellerId, productA, { status: "refunded", amountCents: 3000 });
    await createOrder(buyerB, sellerId, productB, { status: "disputed", amountCents: 4000 });
    await createOrder(buyerA, sellerId, productA, { status: "paid", amountCents: 5000 });
    await createOrder(buyerA, sellerId, productA, { status: "in_progress", amountCents: 6000 });
    await createOrder(buyerB, sellerId, productB, { status: "delivered", amountCents: 7000 });

    await pool.query(
      `insert into reviews(order_id, seller_id, buyer_id, rating, comment)
       values ($1, $3, $4, 5, 'Excellent'), ($2, $3, $5, 3, 'Okay')`,
      [completedA, completedB, sellerId, buyerA, buyerB]
    );

    const response = await request(app).get(`/users/${sellerId}`);

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({ ratingAverage: 4, reviewCount: 2 });
    expect(response.body.stats).toEqual({
      activeListings: 2,
      totalSales: 5,
      favoriteCount: 3,
      activeOrders: 3,
      completedOrders: 2,
      disputedOrders: 1,
      refundedOrders: 1,
      completedRevenueCents: "3000",
      successRate: 50,
      hasEnoughData: true
    });
  });

  it("returns null successRate and hasEnoughData=false for a new seller", async () => {
    const sellerId = await createUser("user");

    const response = await request(app).get(`/users/${sellerId}`);

    expect(response.status).toBe(200);
    expect(response.body.stats).toEqual({
      activeListings: 0,
      totalSales: 0,
      favoriteCount: 0,
      activeOrders: 0,
      completedOrders: 0,
      disputedOrders: 0,
      refundedOrders: 0,
      completedRevenueCents: "0",
      successRate: null,
      hasEnoughData: false
    });
  });
});

describe("public category counters", () => {
  it("counts exactly the products visible in the public list", async () => {
    const visibleSeller = await createUser("user");
    const bannedSeller = await createUser("user");
    const visibleProduct = await createProduct(visibleSeller, { stock: 1 });
    await createProduct(visibleSeller, { stock: 0 });
    const pausedProduct = await createProduct(visibleSeller, { stock: 1 });
    await pool.query(`update products set status = 'paused' where id = $1`, [pausedProduct]);
    await createProduct(bannedSeller, { stock: 1 });
    await pool.query(`update users set is_banned = true where id = $1`, [bannedSeller]);

    const category = await pool.query<{ id: string; slug: string }>(
      `select c.id, c.slug
       from categories c
       join products p on p.category_id = c.id
       where p.id = $1`,
      [visibleProduct]
    );
    await cacheDel("categories");
    await cacheDelPrefixes("marketplace:products:");

    const categories = await request(app).get("/marketplace/categories");
    const categoryRow = categories.body.categories.find(
      (row: { id: string }) => row.id === category.rows[0].id
    );
    const products = await request(app).get(
      `/marketplace/products?category=${encodeURIComponent(category.rows[0].slug)}`
    );

    expect(categories.status).toBe(200);
    expect(categoryRow.activeProductCount).toBe(1);
    expect(products.status).toBe(200);
    expect(products.body.products.map((product: { id: string }) => product.id)).toEqual([visibleProduct]);
  });
});
