import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { getRedis } from "../src/common/redis.js";
import { issueSession } from "../src/modules/auth/session.service.js";
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
});
