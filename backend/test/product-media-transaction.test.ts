import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { getRedis } from "../src/common/redis.js";
import { issueSession } from "../src/modules/auth/session.service.js";
import { closeDb, createProduct, createUser, resetDb } from "./fixtures.js";

/**
 * Product row changes and product_media replacement must be atomic: a failed media write
 * may never leave a listing stripped of its images or half-updated.
 */

const app = createApp();

beforeEach(resetDb);
afterAll(async () => {
  await getRedis()?.quit();
  await closeDb();
});

async function sellerAgent() {
  const userId = await createUser("user");
  await pool.query(`update users set email_verified_at = now() where id = $1`, [userId]);
  const session = await issueSession(userId, "user");
  const cookie = [`access_token=${session.accessToken}`, `csrf_token=${session.csrfToken}`];
  return {
    userId,
    patch: (path: string) => request(app).patch(path).set("Cookie", cookie).set("X-CSRF-Token", session.csrfToken)
  };
}

async function mediaUrls(productId: string) {
  const result = await pool.query<{ url: string }>(`select url from product_media where product_id = $1 order by sort_order`, [productId]);
  return result.rows.map((row) => row.url);
}

describe("product/media atomicity", () => {
  it("replaces media together with the product update", async () => {
    const seller = await sellerAgent();
    const productId = await createProduct(seller.userId);
    await pool.query(`insert into product_media(product_id, url, sort_order) values ($1, 'https://cdn.test/old.jpg', 0)`, [productId]);

    const response = await seller
      .patch(`/marketplace/products/${productId}`)
      .send({ title: "Updated title for the listing", media: ["https://cdn.test/new-1.jpg", "https://cdn.test/new-2.jpg"] });
    expect(response.status).toBe(200);
    expect(await mediaUrls(productId)).toEqual(["https://cdn.test/new-1.jpg", "https://cdn.test/new-2.jpg"]);
  });

  it("keeps the previous media and product state when the media write fails mid-transaction", async () => {
    const seller = await sellerAgent();
    const productId = await createProduct(seller.userId);
    await pool.query(`insert into product_media(product_id, url, sort_order) values ($1, 'https://cdn.test/old.jpg', 0)`, [productId]);
    const originalTitle = (await pool.query<{ title: string }>(`select title from products where id = $1`, [productId])).rows[0].title;

    // Deterministically fail the media INSERT *after* the in-transaction DELETE - exactly
    // the failure window that used to strip a listing of its media.
    await pool.query(`
      create or replace function test_fail_media_insert() returns trigger as $$
      begin
        if new.url like '%boom%' then raise exception 'media insert failure injected by test'; end if;
        return new;
      end $$ language plpgsql`);
    await pool.query(`create trigger test_fail_media before insert on product_media for each row execute function test_fail_media_insert()`);

    try {
      const response = await seller
        .patch(`/marketplace/products/${productId}`)
        .send({ title: "This update must be rolled back", media: ["https://cdn.test/boom.jpg"] });
      expect(response.status).toBeGreaterThanOrEqual(500);

      // Media survived and the accompanying product update was rolled back with it.
      expect(await mediaUrls(productId)).toEqual(["https://cdn.test/old.jpg"]);
      const title = (await pool.query<{ title: string }>(`select title from products where id = $1`, [productId])).rows[0].title;
      expect(title).toBe(originalTitle);
    } finally {
      await pool.query(`drop trigger if exists test_fail_media on product_media`);
      await pool.query(`drop function if exists test_fail_media_insert()`);
    }
  });
});
