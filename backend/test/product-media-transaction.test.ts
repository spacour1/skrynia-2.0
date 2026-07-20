import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { getRedis } from "../src/common/redis.js";
import { issueSession } from "../src/modules/auth/session.service.js";
import { buildMediaUrl } from "../src/modules/storage/storage.service.js";
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

async function temporaryProductUpload(ownerId: string) {
  const objectKey = `product_media/${ownerId}/${randomUUID()}.webp`;
  const result = await pool.query<{ id: string }>(
    `insert into storage_objects(
       owner_id, object_key, storage_driver, purpose, mime_type,
       size_bytes, width, height
     )
     values ($1, $2, 'local', 'product_media', 'image/webp', 10, 10, 10)
     returning id`,
    [ownerId, objectKey]
  );
  return { id: result.rows[0].id, url: buildMediaUrl(objectKey) };
}

describe("product/media atomicity", () => {
  it("replaces media together with the product update", async () => {
    const seller = await sellerAgent();
    const productId = await createProduct(seller.userId);
    const first = await temporaryProductUpload(seller.userId);
    const second = await temporaryProductUpload(seller.userId);
    await pool.query(`insert into product_media(product_id, url, sort_order) values ($1, 'https://cdn.test/old.jpg', 0)`, [productId]);

    const response = await seller
      .patch(`/marketplace/products/${productId}`)
      .send({
        title: "Updated title for the listing",
        mediaUploadIds: [first.id, second.id]
      });
    expect(response.status).toBe(200);
    expect(await mediaUrls(productId)).toEqual([first.url, second.url]);
  });

  it("keeps the previous media and product state when the media write fails mid-transaction", async () => {
    const seller = await sellerAgent();
    const productId = await createProduct(seller.userId);
    const upload = await temporaryProductUpload(seller.userId);
    await pool.query(`insert into product_media(product_id, url, sort_order) values ($1, 'https://cdn.test/old.jpg', 0)`, [productId]);
    const originalTitle = (await pool.query<{ title: string }>(`select title from products where id = $1`, [productId])).rows[0].title;

    // Deterministically fail the media INSERT *after* the in-transaction DELETE - exactly
    // the failure window that used to strip a listing of its media.
    await pool.query(`
      create or replace function test_fail_media_insert() returns trigger as $$
      begin
        if new.storage_object_id is not null then raise exception 'media insert failure injected by test'; end if;
        return new;
      end $$ language plpgsql`);
    await pool.query(`create trigger test_fail_media before insert on product_media for each row execute function test_fail_media_insert()`);

    try {
      const response = await seller
        .patch(`/marketplace/products/${productId}`)
        .send({
          title: "This update must be rolled back",
          mediaUploadIds: [upload.id]
        });
      expect(response.status).toBeGreaterThanOrEqual(500);

      // Media survived and the accompanying product update was rolled back with it.
      expect(await mediaUrls(productId)).toEqual(["https://cdn.test/old.jpg"]);
      const title = (await pool.query<{ title: string }>(`select title from products where id = $1`, [productId])).rows[0].title;
      expect(title).toBe(originalTitle);
      const storage = await pool.query<{ status: string }>(
        `select status from storage_objects where id = $1`,
        [upload.id]
      );
      expect(storage.rows[0].status).toBe("temporary");
    } finally {
      await pool.query(`drop trigger if exists test_fail_media on product_media`);
      await pool.query(`drop function if exists test_fail_media_insert()`);
    }
  });
});
