import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { createApp } from "../src/app.js";
import { env } from "../src/config/env.js";
import { inTx, pool } from "../src/db/pool.js";
import { issueSession } from "../src/modules/auth/session.service.js";
import { sendMessage } from "../src/modules/chat/chat.service.js";
import { processOutboxBatch } from "../src/modules/outbox/outbox.worker.js";
import {
  buildMediaUrl,
  cleanupTemporaryStorageObjects,
  enqueueStorageDeletion
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

  it("rejects invalid bytes, truncated images, and independent dimension limits", async () => {
    const owner = await authedClient();
    const invalid = await owner.upload(
      "avatar",
      Buffer.from("this is not an image"),
      "image/png"
    );
    expect(invalid.status).toBe(400);

    const valid = await png();
    const truncated = await owner.upload(
      "avatar",
      valid.subarray(0, 24),
      "image/png"
    );
    expect(truncated.status).toBe(400);

    const tooWide = await owner.upload(
      "avatar",
      await png(env.STORAGE_MAX_IMAGE_WIDTH + 1, 1)
    );
    expect(tooWide.status).toBe(400);

    const tooTall = await owner.upload(
      "avatar",
      await png(1, env.STORAGE_MAX_IMAGE_HEIGHT + 1)
    );
    expect(tooTall.status).toBe(400);

    const objects = await pool.query<{ count: string }>(
      `select count(*)::text as count from storage_objects where owner_id = $1`,
      [owner.userId]
    );
    expect(objects.rows[0].count).toBe("0");
  });

  it("rejects files over 8 MiB before creating a storage reservation", async () => {
    const owner = await authedClient();
    const response = await owner.upload(
      "avatar",
      Buffer.alloc(8 * 1024 * 1024 + 1),
      "image/png"
    );

    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe("payload_too_large");
    const objects = await pool.query<{ count: string }>(
      `select count(*)::text as count from storage_objects where owner_id = $1`,
      [owner.userId]
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

  it("accepts WebP input and preserves transparency while re-encoding", async () => {
    const owner = await authedClient();
    const source = await sharp({
      create: {
        width: 5,
        height: 4,
        channels: 4,
        background: { r: 40, g: 90, b: 160, alpha: 0.25 }
      }
    })
      .webp({ lossless: true })
      .toBuffer();

    const response = await owner.upload("avatar", source, "image/webp");
    expect(response.status).toBe(201);
    expect(response.body.upload).toMatchObject({
      mimeType: "image/webp",
      width: 5,
      height: 4
    });

    const stored = await pool.query<{ objectKey: string }>(
      `select object_key as "objectKey" from storage_objects where id = $1`,
      [response.body.upload.id]
    );
    const decoded = await sharp(
      path.resolve(env.LOCAL_UPLOAD_DIR, ...stored.rows[0].objectKey.split("/"))
    )
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(decoded.info.channels).toBe(4);
    expect(
      Array.from(decoded.data).some(
        (value, index) => index % decoded.info.channels === 3 && value < 255
      )
    ).toBe(true);
  });

  it("records a durable deletion intent when the physical provider write fails", async () => {
    const owner = await authedClient();
    const originalUploadDir = env.LOCAL_UPLOAD_DIR;
    const blockedUploadDir = path.resolve(
      originalUploadDir,
      `provider-write-blocker-${owner.userId}`
    );
    await fs.mkdir(path.dirname(blockedUploadDir), { recursive: true });
    await fs.writeFile(blockedUploadDir, "not a directory");
    env.LOCAL_UPLOAD_DIR = blockedUploadDir;

    try {
      const response = await owner.upload("avatar", await png());
      expect(response.status).toBe(500);

      const stored = await pool.query<{
        id: string;
        status: string;
        eventStatus: string;
      }>(
        `select object.id, object.status, event.status as "eventStatus"
         from storage_objects object
         join domain_outbox event
           on event.aggregate_type = 'storage_object'
          and event.aggregate_id = object.id::text
          and event.event_type = 'storage.delete'
         where object.owner_id = $1`,
        [owner.userId]
      );
      expect(stored.rows).toEqual([
        {
          id: expect.any(String),
          status: "deleting",
          eventStatus: "pending"
        }
      ]);
    } finally {
      env.LOCAL_UPLOAD_DIR = originalUploadDir;
      await fs.unlink(blockedUploadDir);
    }
  });

  it("does not write a provider object when the initial DB reservation fails", async () => {
    const owner = await authedClient();
    const ownerDirectory = path.resolve(
      env.LOCAL_UPLOAD_DIR,
      "avatar",
      owner.userId
    );
    await pool.query(`
      create or replace function test_fail_storage_reservation()
      returns trigger as $$
      begin
        raise exception 'storage reservation failure';
      end
      $$ language plpgsql
    `);
    await pool.query(`
      create trigger test_fail_storage_reservation
      before insert on storage_objects
      for each row execute function test_fail_storage_reservation()
    `);

    try {
      const response = await owner.upload("avatar", await png());
      expect(response.status).toBe(500);
      const objects = await pool.query<{ count: string }>(
        `select count(*)::text as count from storage_objects where owner_id = $1`,
        [owner.userId]
      );
      expect(objects.rows[0].count).toBe("0");
      await expect(fs.stat(ownerDirectory)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await pool.query(
        `drop trigger if exists test_fail_storage_reservation on storage_objects`
      );
      await pool.query(`drop function if exists test_fail_storage_reservation()`);
    }
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
    await expect(cleanupTemporaryStorageObjects({ olderThanHours: 1 })).resolves.toMatchObject({
      queued: 1,
      failed: 0
    });
    await processOutboxBatch({ workerId: "storage-cleanup-test" });
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

  it("recovers a physical upload after DB finalization and intent writes fail", async () => {
    const owner = await authedClient();
    await pool.query(`
      create or replace function test_fail_storage_upload_transition()
      returns trigger as $$
      begin
        if old.status = 'uploading' then
          raise exception 'storage upload transition failure';
        end if;
        return new;
      end
      $$ language plpgsql
    `);
    await pool.query(`
      create trigger test_fail_storage_upload_transition
      before update of status on storage_objects
      for each row execute function test_fail_storage_upload_transition()
    `);

    let stored!: { id: string; objectKey: string; status: string };
    try {
      const response = await owner.upload("avatar", await png());
      expect(response.status).toBe(500);

      const result = await pool.query<typeof stored>(
        `select id, object_key as "objectKey", status
         from storage_objects
         where owner_id = $1`,
        [owner.userId]
      );
      stored = result.rows[0];
      expect(stored.status).toBe("uploading");
      await expect(
        fs.stat(path.resolve(env.LOCAL_UPLOAD_DIR, ...stored.objectKey.split("/")))
      ).resolves.toBeDefined();

      const events = await pool.query<{ count: number }>(
        `select count(*)::int as count
         from domain_outbox
         where event_key = $1`,
        [`storage.delete:${stored.id}`]
      );
      expect(events.rows[0].count).toBe(0);
    } finally {
      await pool.query(`drop trigger if exists test_fail_storage_upload_transition on storage_objects`);
      await pool.query(`drop function if exists test_fail_storage_upload_transition()`);
    }

    await pool.query(
      `update storage_objects
       set created_at = now() - interval '2 hours'
       where id = $1`,
      [stored.id]
    );
    await expect(cleanupTemporaryStorageObjects({ olderThanHours: 1 })).resolves.toMatchObject({
      queued: 1,
      failed: 0
    });
    expect(
      (await pool.query<{ status: string }>(`select status from storage_objects where id = $1`, [stored.id]))
        .rows[0].status
    ).toBe("deleting");

    await expect(
      processOutboxBatch({ workerId: "storage-upload-recovery" })
    ).resolves.toMatchObject({ processed: 1, failed: 0 });
    await expect(
      fs.stat(path.resolve(env.LOCAL_UPLOAD_DIR, ...stored.objectKey.split("/")))
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      (await pool.query<{ status: string }>(`select status from storage_objects where id = $1`, [stored.id]))
        .rows[0].status
    ).toBe("deleted");
  });

  it("keeps failed provider deletion retryable and charged to quota", async () => {
    const owner = await authedClient();
    const response = await owner.upload("avatar", await png());
    const stored = await pool.query<{ id: string; objectKey: string }>(
      `update storage_objects
       set size_bytes = $2, created_at = now() - interval '48 hours'
       where id = $1
       returning id, object_key as "objectKey"`,
      [response.body.upload.id, env.STORAGE_TOTAL_QUOTA_BYTES_PER_USER]
    );
    const object = stored.rows[0];
    const file = path.resolve(env.LOCAL_UPLOAD_DIR, ...object.objectKey.split("/"));
    await inTx((client) => enqueueStorageDeletion(client, object.id));

    await fs.unlink(file);
    await fs.mkdir(file);
    await expect(
      processOutboxBatch({
        workerId: "storage-delete-failure",
        maxAttempts: 1,
        baseBackoffMs: 10
      })
    ).resolves.toMatchObject({ processed: 0, failed: 1 });

    const failed = await pool.query<{ objectStatus: string; eventStatus: string; attempts: number }>(
      `select s.status as "objectStatus", o.status as "eventStatus", o.attempts
       from storage_objects s
       join domain_outbox o on o.event_key = 'storage.delete:' || s.id::text
       where s.id = $1`,
      [object.id]
    );
    expect(failed.rows[0]).toEqual({
      objectStatus: "deleting",
      eventStatus: "failed",
      attempts: 1
    });
    const stillCharged = await owner.upload("avatar", await png());
    expect(stillCharged.status).toBe(400);
    expect(stillCharged.body.error.code).toBe("storage_quota_exceeded");

    await expect(cleanupTemporaryStorageObjects()).resolves.toMatchObject({
      queued: 1,
      failed: 0
    });
    const revived = await pool.query<{ status: string; attempts: number }>(
      `select status, attempts from domain_outbox where event_key = $1`,
      [`storage.delete:${object.id}`]
    );
    expect(revived.rows[0]).toEqual({ status: "pending", attempts: 0 });

    await fs.rmdir(file);
    await fs.writeFile(file, "retry deletion target");
    await expect(
      processOutboxBatch({
        workerId: "storage-delete-retry",
        maxAttempts: 3,
        baseBackoffMs: 10
      })
    ).resolves.toMatchObject({ processed: 1, failed: 0 });

    const recovered = await pool.query<{ objectStatus: string; eventStatus: string; attempts: number }>(
      `select s.status as "objectStatus", o.status as "eventStatus", o.attempts
       from storage_objects s
       join domain_outbox o on o.event_key = 'storage.delete:' || s.id::text
       where s.id = $1`,
      [object.id]
    );
    expect(recovered.rows[0]).toEqual({
      objectStatus: "deleted",
      eventStatus: "processed",
      attempts: 1
    });
    await expect(fs.stat(file)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await owner.upload("avatar", await png())).status).toBe(201);
  });

  it("treats an already-missing provider object as a successful idempotent delete", async () => {
    const owner = await authedClient();
    const response = await owner.upload("avatar", await png());
    const stored = await pool.query<{ id: string; objectKey: string }>(
      `select id, object_key as "objectKey"
       from storage_objects
       where id = $1`,
      [response.body.upload.id]
    );
    const object = stored.rows[0];
    const file = path.resolve(env.LOCAL_UPLOAD_DIR, ...object.objectKey.split("/"));
    await inTx((client) => enqueueStorageDeletion(client, object.id));
    await fs.unlink(file);

    await expect(
      processOutboxBatch({ workerId: "storage-delete-missing" })
    ).resolves.toMatchObject({ processed: 1, failed: 0 });
    const result = await pool.query<{ objectStatus: string; eventStatus: string }>(
      `select s.status as "objectStatus", o.status as "eventStatus"
       from storage_objects s
       join domain_outbox o on o.event_key = 'storage.delete:' || s.id::text
       where s.id = $1`,
      [object.id]
    );
    expect(result.rows[0]).toEqual({
      objectStatus: "deleted",
      eventStatus: "processed"
    });
  });

  it("fairly reconciles stale uploads alongside a backlog of terminal deletions", async () => {
    const owner = await authedClient();
    const deleting = await pool.query<{ id: string }>(
      `insert into storage_objects(
         owner_id, object_key, storage_driver, purpose, mime_type,
         size_bytes, width, height, status, created_at
       )
       select $1, 'test/deleting-' || gs, 'local', 'avatar', 'image/webp',
              1, 1, 1, 'deleting', now() - interval '48 hours'
       from generate_series(1, 4) gs
       returning id`,
      [owner.userId]
    );
    for (const object of deleting.rows) {
      await pool.query(
        `insert into domain_outbox(
           event_key, event_type, aggregate_type, aggregate_id, payload,
           status, attempts, last_error
         )
         values ($1, 'storage.delete', 'storage_object', $2, $3, 'failed', 8, 'provider unavailable')`,
        [
          `storage.delete:${object.id}`,
          object.id,
          JSON.stringify({ storageObjectId: object.id })
        ]
      );
    }
    const uploading = await pool.query<{ id: string }>(
      `insert into storage_objects(
         owner_id, object_key, storage_driver, purpose, mime_type,
         size_bytes, width, height, status, created_at
       )
       values ($1, 'test/stale-upload', 'local', 'avatar', 'image/webp',
               1, 1, 1, 'uploading', now() - interval '2 hours')
       returning id`,
      [owner.userId]
    );

    await expect(
      cleanupTemporaryStorageObjects({ olderThanHours: 1, batchSize: 2 })
    ).resolves.toEqual({ claimed: 2, queued: 2, failed: 0 });

    const uploadState = await pool.query<{ objectStatus: string; eventStatus: string }>(
      `select s.status as "objectStatus", o.status as "eventStatus"
       from storage_objects s
       join domain_outbox o on o.aggregate_id = s.id::text and o.event_type = 'storage.delete'
       where s.id = $1`,
      [uploading.rows[0].id]
    );
    expect(uploadState.rows[0]).toEqual({
      objectStatus: "deleting",
      eventStatus: "pending"
    });
    const revived = await pool.query<{ count: number }>(
      `select count(*)::int as count
       from domain_outbox
       where aggregate_id::uuid = any($1::uuid[])
         and status = 'pending'`,
      [deleting.rows.map((object) => object.id)]
    );
    expect(revived.rows[0].count).toBe(1);
  });

  it("does not enqueue a duplicate while an upload-recovery deletion is active", async () => {
    const owner = await authedClient();
    const object = await pool.query<{ id: string }>(
      `insert into storage_objects(
         owner_id, object_key, storage_driver, purpose, mime_type,
         size_bytes, width, height, status, created_at
       )
       values ($1, 'test/late-upload', 'local', 'avatar', 'image/webp',
               1, 1, 1, 'deleting', now() - interval '48 hours')
       returning id`,
      [owner.userId]
    );
    await pool.query(
      `insert into domain_outbox(event_key, event_type, aggregate_type, aggregate_id, payload)
       values ($1, 'storage.delete', 'storage_object', $2, $3)`,
      [
        `storage.delete:${object.rows[0].id}:upload-recovery`,
        object.rows[0].id,
        JSON.stringify({ storageObjectId: object.rows[0].id })
      ]
    );

    await expect(cleanupTemporaryStorageObjects({ batchSize: 10 })).resolves.toEqual({
      claimed: 0,
      queued: 0,
      failed: 0
    });
    const count = await pool.query<{ count: number }>(
      `select count(*)::int as count
       from domain_outbox
       where aggregate_id = $1 and event_type = 'storage.delete'`,
      [object.rows[0].id]
    );
    expect(count.rows[0].count).toBe(1);
  });

  it("revives a failed late-upload intent instead of a processed default event", async () => {
    const owner = await authedClient();
    const object = await pool.query<{ id: string }>(
      `insert into storage_objects(
         owner_id, object_key, storage_driver, purpose, mime_type,
         size_bytes, width, height, status, created_at
       )
       values ($1, 'test/failed-late-upload', 'local', 'avatar', 'image/webp',
               1, 1, 1, 'deleting', now() - interval '48 hours')
       returning id`,
      [owner.userId]
    );
    const defaultKey = `storage.delete:${object.rows[0].id}`;
    const recoveryKey = `${defaultKey}:upload-recovery`;
    await pool.query(
      `insert into domain_outbox(
         event_key, event_type, aggregate_type, aggregate_id, payload,
         status, attempts, processed_at, last_error
       )
       values
         ($1, 'storage.delete', 'storage_object', $3, $4, 'processed', 1, now(), null),
         ($2, 'storage.delete', 'storage_object', $3, $4, 'failed', 8, null, 'provider unavailable')`,
      [
        defaultKey,
        recoveryKey,
        object.rows[0].id,
        JSON.stringify({ storageObjectId: object.rows[0].id })
      ]
    );

    await expect(cleanupTemporaryStorageObjects({ batchSize: 10 })).resolves.toEqual({
      claimed: 1,
      queued: 1,
      failed: 0
    });
    const events = await pool.query<{ eventKey: string; status: string; attempts: number }>(
      `select event_key as "eventKey", status, attempts
       from domain_outbox
       where aggregate_id = $1 and event_type = 'storage.delete'
       order by event_key`,
      [object.rows[0].id]
    );
    expect(events.rows).toEqual([
      { eventKey: defaultKey, status: "processed", attempts: 1 },
      { eventKey: recoveryKey, status: "pending", attempts: 0 }
    ]);
  });

  it("reopens a confirmed deletion when a provider upload finishes late", async () => {
    const owner = await authedClient();
    const object = await pool.query<{ id: string; objectKey: string }>(
      `insert into storage_objects(
         owner_id, object_key, storage_driver, purpose, mime_type,
         size_bytes, width, height, status, deleted_at
       )
       values ($1, 'test/late-provider-write', 'local', 'avatar', 'image/webp',
               1, 1, 1, 'deleted', now())
       returning id, object_key as "objectKey"`,
      [owner.userId]
    );
    const file = path.resolve(
      env.LOCAL_UPLOAD_DIR,
      ...object.rows[0].objectKey.split("/")
    );
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "provider write completed after cleanup");

    await inTx((client) =>
      enqueueStorageDeletion(client, object.rows[0].id, {
        reopenDeleted: true,
        eventKey: `storage.delete:${object.rows[0].id}:upload-recovery`
      })
    );
    const reopened = await pool.query<{
      objectStatus: string;
      deletedAt: Date | null;
      eventStatus: string;
    }>(
      `select s.status as "objectStatus", s.deleted_at as "deletedAt",
              o.status as "eventStatus"
       from storage_objects s
       join domain_outbox o on o.aggregate_id = s.id::text
       where s.id = $1 and o.event_type = 'storage.delete'`,
      [object.rows[0].id]
    );
    expect(reopened.rows[0]).toEqual({
      objectStatus: "deleting",
      deletedAt: null,
      eventStatus: "pending"
    });

    await expect(
      processOutboxBatch({ workerId: "storage-late-upload-recovery" })
    ).resolves.toMatchObject({ processed: 1, failed: 0 });
    await expect(fs.stat(file)).rejects.toMatchObject({ code: "ENOENT" });
    const deleted = await pool.query<{ objectStatus: string; eventStatus: string }>(
      `select s.status as "objectStatus", o.status as "eventStatus"
       from storage_objects s
       join domain_outbox o on o.aggregate_id = s.id::text
       where s.id = $1 and o.event_type = 'storage.delete'`,
      [object.rows[0].id]
    );
    expect(deleted.rows[0]).toEqual({
      objectStatus: "deleted",
      eventStatus: "processed"
    });
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
