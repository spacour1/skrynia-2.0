import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { createApp } from "../src/app.js";
import { env } from "../src/config/env.js";
import { pool } from "../src/db/pool.js";
import { issueSession } from "../src/modules/auth/session.service.js";
import { sendMessage } from "../src/modules/chat/chat.service.js";
import { processOutboxBatch } from "../src/modules/outbox/outbox.worker.js";
import {
  buildMediaUrl,
  cleanupTemporaryStorageObjects
} from "../src/modules/storage/storage.service.js";
import { getRedis } from "../src/common/redis.js";
import {
  closeDb,
  createConversation,
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

async function authedClient(role: "user" | "admin" = "user") {
  const userId = await createUser(role);
  const session = await issueSession(userId, role);
  const cookie = [
    `access_token=${session.accessToken}`,
    `csrf_token=${session.csrfToken}`
  ];
  return {
    userId,
    upload: (
      purpose: "avatar" | "product_media" | "chat_attachment" | "catalog_asset",
      buffer: Buffer,
      mimeType = "image/png"
    ) =>
      request(app)
        .post("/storage/upload")
        .set("Cookie", cookie)
        .set("X-CSRF-Token", session.csrfToken)
        .field("purpose", purpose)
        .attach("file", buffer, { filename: "image", contentType: mimeType }),
    patch: (url: string) =>
      request(app)
        .patch(url)
        .set("Cookie", cookie)
        .set("X-CSRF-Token", session.csrfToken)
  };
}

async function png(width = 20, height = 12) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 20, g: 120, b: 200 }
    }
  })
    .png()
    .toBuffer();
}

describe("owned processed storage", () => {
  it("returns object metadata and forbids another user from attaching it", async () => {
    const owner = await authedClient();
    const other = await authedClient();
    const uploaded = await owner.upload("product_media", await png());

    expect(uploaded.status).toBe(201);
    expect(uploaded.body.upload).toMatchObject({
      id: expect.any(String),
      url: expect.stringMatching(/\.webp$/),
      mimeType: "image/webp",
      width: 20,
      height: 12
    });

    const productId = await createProduct(other.userId);
    const attached = await other
      .patch(`/marketplace/products/${productId}`)
      .send({ mediaUploadIds: [uploaded.body.upload.id] });
    expect(attached.status).toBe(403);

    const object = await pool.query<{ status: string }>(
      `select status from storage_objects where id = $1`,
      [uploaded.body.upload.id]
    );
    expect(object.rows[0].status).toBe("temporary");
  });

  it("rejects forged MIME declarations and oversized dimensions", async () => {
    const owner = await authedClient();
    const forged = await owner.upload("avatar", await png(), "image/jpeg");
    expect(forged.status).toBe(400);

    const oversized = await owner.upload(
      "avatar",
      await png(7_000, 6_000)
    );
    expect(oversized.status).toBe(400);

    const objects = await pool.query<{ count: string }>(
      `select count(*)::text as count from storage_objects`
    );
    expect(objects.rows[0].count).toBe("0");
  });

  it("auto-rotates, re-encodes, and strips EXIF metadata", async () => {
    const owner = await authedClient();
    const jpeg = await sharp({
      create: {
        width: 3,
        height: 2,
        channels: 3,
        background: { r: 220, g: 40, b: 30 }
      }
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();

    const response = await owner.upload("avatar", jpeg, "image/jpeg");
    expect(response.status).toBe(201);
    expect(response.body.upload).toMatchObject({
      mimeType: "image/webp",
      width: 2,
      height: 3
    });

    const stored = await pool.query<{ objectKey: string }>(
      `select object_key as "objectKey" from storage_objects where id = $1`,
      [response.body.upload.id]
    );
    const metadata = await sharp(
      path.resolve(env.LOCAL_UPLOAD_DIR, ...stored.rows[0].objectKey.split("/"))
    ).metadata();
    expect(metadata.format).toBe("webp");
    expect(metadata.orientation).toBeUndefined();
    expect(metadata.exif).toBeUndefined();
  });

  it("builds public S3/CDN URLs without using S3_ENDPOINT", () => {
    expect(
      buildMediaUrl(
        "product_media/user/object.webp",
        "https://media.example.test/assets/"
      )
    ).toBe(
      "https://media.example.test/assets/product_media/user/object.webp"
    );
  });

  it("physically deletes expired temporary objects and marks them deleted", async () => {
    const owner = await authedClient();
    const response = await owner.upload("avatar", await png());
    const object = await pool.query<{ objectKey: string }>(
      `update storage_objects
       set created_at = now() - interval '2 hours'
       where id = $1
       returning object_key as "objectKey"`,
      [response.body.upload.id]
    );
    const file = path.resolve(
      env.LOCAL_UPLOAD_DIR,
      ...object.rows[0].objectKey.split("/")
    );

    await expect(fs.stat(file)).resolves.toBeDefined();
    await expect(
      cleanupTemporaryStorageObjects({ olderThanHours: 1 })
    ).resolves.toMatchObject({ deleted: 1, failed: 0 });
    await expect(fs.stat(file)).rejects.toMatchObject({ code: "ENOENT" });

    const stored = await pool.query<{ status: string; deletedAt: Date | null }>(
      `select status, deleted_at as "deletedAt"
       from storage_objects
       where id = $1`,
      [response.body.upload.id]
    );
    expect(stored.rows[0].status).toBe("deleted");
    expect(stored.rows[0].deletedAt).toBeInstanceOf(Date);
  });

  it("attaches chat images by ID instead of accepting a client URL", async () => {
    const sender = await authedClient();
    const recipientId = await createUser();
    const conversationId = await createConversation(
      sender.userId,
      recipientId
    );
    const response = await sender.upload("chat_attachment", await png());

    const message = await sendMessage({
      conversationId,
      senderId: sender.userId,
      body: "Processed attachment",
      attachmentUploadId: response.body.upload.id
    });
    expect(message.attachmentUrl).toBe(response.body.upload.url);

    const object = await pool.query<{ status: string }>(
      `select status from storage_objects where id = $1`,
      [response.body.upload.id]
    );
    expect(object.rows[0].status).toBe("attached");
  });

  it("attaches avatar replacement transactionally and deletes the old object through outbox", async () => {
    const owner = await authedClient();
    const first = await owner.upload("avatar", await png());
    const firstAttach = await owner
      .patch("/users/me")
      .send({ avatarUploadId: first.body.upload.id });
    expect(firstAttach.status).toBe(200);
    expect(firstAttach.body.user.avatarUrl).toBe(first.body.upload.url);

    const second = await owner.upload("avatar", await png(24, 24));
    const secondAttach = await owner
      .patch("/users/me")
      .send({ avatarUploadId: second.body.upload.id });
    expect(secondAttach.status).toBe(200);
    expect(secondAttach.body.user.avatarUrl).toBe(second.body.upload.url);

    const queued = await pool.query<{ status: string }>(
      `select status from domain_outbox
       where event_key = $1`,
      [`storage.delete:${first.body.upload.id}`]
    );
    expect(queued.rows[0].status).toBe("pending");

    await processOutboxBatch({ workerId: "storage-test" });
    const objects = await pool.query<{ id: string; status: string }>(
      `select id, status
       from storage_objects
       where id = any($1::uuid[])
       order by id`,
      [[first.body.upload.id, second.body.upload.id]]
    );
    expect(
      Object.fromEntries(objects.rows.map((object) => [object.id, object.status]))
    ).toEqual({
      [first.body.upload.id]: "deleted",
      [second.body.upload.id]: "attached"
    });
  });

  it("rolls back attachment state when a product media write fails", async () => {
    const seller = await authedClient();
    const productId = await createProduct(seller.userId);
    const response = await seller.upload("product_media", await png());
    const uploadId = response.body.upload.id as string;
    await pool.query(
      `insert into product_media(product_id, url, sort_order)
       values ($1, 'https://legacy.example/old.webp', 0)`,
      [productId]
    );
    await pool.query(`
      create or replace function test_fail_owned_media_insert()
      returns trigger as $$
      begin
        if new.storage_object_id is not null then
          raise exception 'owned media insert failure';
        end if;
        return new;
      end
      $$ language plpgsql
    `);
    await pool.query(`
      create trigger test_fail_owned_media
      before insert on product_media
      for each row execute function test_fail_owned_media_insert()
    `);

    try {
      const update = await seller
        .patch(`/marketplace/products/${productId}`)
        .send({
          title: "This title must roll back too",
          mediaUploadIds: [uploadId]
        });
      expect(update.status).toBeGreaterThanOrEqual(500);

      const object = await pool.query<{ status: string }>(
        `select status from storage_objects where id = $1`,
        [uploadId]
      );
      expect(object.rows[0].status).toBe("temporary");
      const media = await pool.query<{ url: string }>(
        `select url from product_media where product_id = $1`,
        [productId]
      );
      expect(media.rows.map((row) => row.url)).toEqual([
        "https://legacy.example/old.webp"
      ]);
    } finally {
      await pool.query(
        `drop trigger if exists test_fail_owned_media on product_media`
      );
      await pool.query(
        `drop function if exists test_fail_owned_media_insert()`
      );
    }
  });
});
