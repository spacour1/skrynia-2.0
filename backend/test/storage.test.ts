import fs from "node:fs/promises";
import path from "node:path";
import { S3Client } from "@aws-sdk/client-s3";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { createApp } from "../src/app.js";
import { env } from "../src/config/env.js";
import { inTx, pool } from "../src/db/pool.js";
import { issueSession } from "../src/modules/auth/session.service.js";
import { sendMessage } from "../src/modules/chat/chat.service.js";
import { processOutboxBatch } from "../src/modules/outbox/outbox.worker.js";
import {
  assertStorageObjectAvailable,
  buildPrivateMediaUrl,
  buildPublicMediaUrl,
  cleanupTemporaryStorageObjects,
  enqueueStorageDeletion,
  isPrivateStoragePurpose,
  isPublicStoragePurpose,
  readStorageObjectBody,
  StorageReadSemaphore,
  type StorageObject
} from "../src/modules/storage/storage.service.js";
import { getRedis } from "../src/common/redis.js";
import { logger } from "../src/common/logger.js";
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

async function clientFor(userId: string, role: "user" | "admin" = "user") {
  const session = await issueSession(userId, role);
  const cookie = [
    `access_token=${session.accessToken}`,
    `csrf_token=${session.csrfToken}`
  ];
  return {
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
    uploadRequest: () =>
      request(app)
        .post("/storage/upload")
        .set("Cookie", cookie)
        .set("X-CSRF-Token", session.csrfToken),
    patch: (url: string) =>
      request(app)
        .patch(url)
        .set("Cookie", cookie)
        .set("X-CSRF-Token", session.csrfToken),
    post: (url: string) =>
      request(app)
        .post(url)
        .set("Cookie", cookie)
        .set("X-CSRF-Token", session.csrfToken),
    get: (url: string) => request(app).get(url).set("Cookie", cookie),
    head: (url: string) => request(app).head(url).set("Cookie", cookie)
  };
}

async function authedClient(role: "user" | "admin" = "user") {
  const userId = await createUser(role);
  return { userId, ...(await clientFor(userId, role)) };
}

function backendPath(url: string): string {
  if (!url.startsWith("/api/")) throw new Error("Expected a same-origin API media URL");
  return url.slice(4);
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
      url: expect.stringMatching(/^\/api\/storage\/private\/[0-9a-f-]+$/),
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

  it("bounds multipart fields and creates no storage rows or files on rejection", async () => {
    const owner = await authedClient();
    const image = await png();

    const excessFields = await owner
      .uploadRequest()
      .field("purpose", "avatar")
      .field("unexpected", "extra")
      .attach("file", image, { filename: "image", contentType: "image/png" });
    expect(excessFields.status).toBe(400);

    const oversizedPurpose = await owner
      .uploadRequest()
      .field("purpose", "a".repeat(65))
      .attach("file", image, { filename: "image", contentType: "image/png" });
    expect(oversizedPurpose.status).toBe(413);
    expect(oversizedPurpose.body.error.code).toBe("payload_too_large");

    const oversizedFieldName = await owner
      .uploadRequest()
      .field("x".repeat(33), "avatar")
      .attach("file", image, { filename: "image", contentType: "image/png" });
    expect(oversizedFieldName.status).toBe(400);

    const objects = await pool.query<{ count: string }>(
      `select count(*)::text as count from storage_objects where owner_id = $1`,
      [owner.userId]
    );
    expect(objects.rows[0].count).toBe("0");
    await expect(
      fs.stat(path.resolve(env.LOCAL_UPLOAD_DIR, "avatar", owner.userId))
    ).rejects.toMatchObject({ code: "ENOENT" });
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
    const originalDriver = env.STORAGE_DRIVER;
    const originalBucket = env.S3_BUCKET;
    const sentinelBucket = "STAGE5_SECRET_BUCKET_SENTINEL";
    const sentinelObjectKey = "STAGE5_SECRET_OBJECT_KEY_SENTINEL";
    const sentinelPath = "STAGE5_SECRET_PROVIDER_PATH_SENTINEL";
    const send = vi.spyOn(S3Client.prototype, "send").mockRejectedValueOnce(
      Object.assign(
        new Error(
          `bucket=${sentinelBucket} key=${sentinelObjectKey} path=${sentinelPath}`
        ),
        { code: "AccessDenied", name: "AccessDenied" }
      ) as never
    );
    const errorLog = vi.spyOn(logger, "error").mockImplementation(() => logger);
    env.STORAGE_DRIVER = "s3";
    env.S3_BUCKET = sentinelBucket;

    try {
      const response = await owner.upload("avatar", await png());
      expect(response.status).toBe(503);
      expect(response.body.error).toMatchObject({
        code: "service_unavailable",
        message: "Storage provider is temporarily unavailable"
      });
      for (const sentinel of [sentinelBucket, sentinelObjectKey, sentinelPath]) {
        expect(JSON.stringify(response.body)).not.toContain(sentinel);
      }

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
      expect(errorLog).toHaveBeenCalledTimes(1);
      expect(errorLog).toHaveBeenCalledWith(
        {
          storageObjectId: stored.rows[0].id,
          storageDriver: "s3",
          errorCode: "access_denied"
        },
        "storage_provider_write_failed"
      );
      for (const sentinel of [sentinelBucket, sentinelObjectKey, sentinelPath]) {
        expect(JSON.stringify(errorLog.mock.calls)).not.toContain(sentinel);
      }
    } finally {
      errorLog.mockRestore();
      send.mockRestore();
      env.STORAGE_DRIVER = originalDriver;
      env.S3_BUCKET = originalBucket;
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

  it("classifies every storage purpose and builds opaque same-origin URLs", () => {
    const objectId = "3a0d79fa-bbb5-4d9d-8a5f-428994b391cc";
    expect(isPublicStoragePurpose("avatar")).toBe(true);
    expect(isPublicStoragePurpose("product_media")).toBe(true);
    expect(isPublicStoragePurpose("catalog_asset")).toBe(true);
    expect(isPublicStoragePurpose("chat_attachment")).toBe(false);
    expect(isPrivateStoragePurpose("chat_attachment")).toBe(true);
    expect(isPrivateStoragePurpose("avatar")).toBe(false);
    expect(buildPublicMediaUrl(objectId)).toBe(`/api/storage/public/${objectId}`);
    expect(buildPrivateMediaUrl(objectId)).toBe(`/api/storage/private/${objectId}`);
  });

  it("bounds concurrent storage reads", async () => {
    const semaphore = new StorageReadSemaphore(1, 1);
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let cancelledReadStarted = false;
    let replacementReadStarted = false;
    const queuedController = new AbortController();

    const first = semaphore.run(async () => {
      await firstGate;
      return "first";
    });
    const cancelled = semaphore.run(
      async () => {
        cancelledReadStarted = true;
        return "cancelled";
      },
      queuedController.signal
    );

    await Promise.resolve();
    expect(cancelledReadStarted).toBe(false);
    await expect(semaphore.run(async () => "overflow")).rejects.toMatchObject({
      status: 503
    });
    queuedController.abort();
    await expect(cancelled).rejects.toMatchObject({ status: 503 });
    const replacement = semaphore.run(async () => {
      replacementReadStarted = true;
      return "replacement";
    });
    expect(replacementReadStarted).toBe(false);
    releaseFirst();
    await expect(Promise.all([first, replacement])).resolves.toEqual([
      "first",
      "replacement"
    ]);
    expect(cancelledReadStarted).toBe(false);
  });

  it("bounds S3 streams and sanitizes provider failures and timeouts", async () => {
    const originalBucket = env.S3_BUCKET;
    const originalTimeout = env.STORAGE_READ_TIMEOUT_MS;
    const send = vi.spyOn(S3Client.prototype, "send");
    const bytes = Buffer.from("webp");
    const object: StorageObject = {
      id: "3a0d79fa-bbb5-4d9d-8a5f-428994b391cc",
      ownerId: "8c802f3e-b0a3-4d07-a642-f0ba149a38b8",
      objectKey: "chat_attachment/private/test-object.webp",
      storageDriver: "s3",
      purpose: "chat_attachment",
      mimeType: "image/webp",
      sizeBytes: bytes.length,
      width: 1,
      height: 1,
      status: "temporary",
      createdAt: new Date(),
      attachedAt: null,
      deletedAt: null
    };
    const streamBody = (...chunks: Buffer[]) => ({
      async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) yield chunk;
      }
    });

    try {
      env.S3_BUCKET = "stage5-private-test-bucket";
      send.mockResolvedValueOnce({
        ContentLength: bytes.length,
        ContentType: "image/webp",
        Body: streamBody(bytes)
      } as never);
      await expect(readStorageObjectBody(object)).resolves.toEqual(bytes);

      send.mockResolvedValueOnce({
        ContentLength: bytes.length,
        ContentType: "image/webp"
      } as never);
      await expect(assertStorageObjectAvailable(object)).resolves.toBeUndefined();

      send.mockResolvedValueOnce({ ContentLength: bytes.length + 1 } as never);
      await expect(assertStorageObjectAvailable(object)).rejects.toMatchObject({
        status: 503,
        message: "Media is temporarily unavailable"
      });

      let missingLengthBodyRead = false;
      send.mockResolvedValueOnce({
        Body: {
          async *[Symbol.asyncIterator]() {
            missingLengthBodyRead = true;
            yield bytes;
          }
        }
      } as never);
      await expect(readStorageObjectBody(object)).rejects.toMatchObject({
        status: 503,
        message: "Media is temporarily unavailable"
      });
      expect(missingLengthBodyRead).toBe(false);

      send.mockResolvedValueOnce({
        ContentLength: bytes.length,
        ContentType: "image/webp",
        Body: streamBody(bytes, Buffer.from("unexpected-extra-bytes"))
      } as never);
      await expect(readStorageObjectBody(object)).rejects.toMatchObject({
        status: 503,
        message: "Media is temporarily unavailable"
      });

      const providerError = Object.assign(new Error("internal provider detail"), {
        name: "NoSuchKey"
      });
      send.mockRejectedValueOnce(providerError as never);
      await expect(readStorageObjectBody(object)).rejects.toMatchObject({
        status: 503,
        message: "Media is temporarily unavailable"
      });

      env.STORAGE_READ_TIMEOUT_MS = 20;
      let timedOutSignal: AbortSignal | undefined;
      send.mockImplementationOnce(((_command: unknown, options?: {
        abortSignal?: AbortSignal;
      }) => {
        timedOutSignal = options?.abortSignal;
        return new Promise((_resolve, reject) => {
          timedOutSignal?.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true
          });
        });
      }) as never);
      await expect(assertStorageObjectAvailable(object)).rejects.toMatchObject({
        status: 503,
        message: "Media is temporarily unavailable"
      });
      expect(timedOutSignal?.aborted).toBe(true);
    } finally {
      send.mockRestore();
      env.S3_BUCKET = originalBucket;
      env.STORAGE_READ_TIMEOUT_MS = originalTimeout;
    }
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
    const originalFile = path.resolve(
      env.LOCAL_UPLOAD_DIR,
      ...object.objectKey.split("/")
    );
    const sentinel = "STAGE5_SECRET_DELETE_PATH_AND_KEY_SENTINEL";
    object.objectKey = `avatar/${owner.userId}/${sentinel}.webp`;
    const file = path.resolve(env.LOCAL_UPLOAD_DIR, ...object.objectKey.split("/"));
    await fs.rename(originalFile, file);
    await pool.query(`update storage_objects set object_key = $2 where id = $1`, [
      object.id,
      object.objectKey
    ]);
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

    const failed = await pool.query<{
      objectStatus: string;
      eventStatus: string;
      attempts: number;
      lastError: string;
    }>(
      `select s.status as "objectStatus", o.status as "eventStatus", o.attempts,
              o.last_error as "lastError"
       from storage_objects s
       join domain_outbox o on o.event_key = 'storage.delete:' || s.id::text
       where s.id = $1`,
      [object.id]
    );
    expect(failed.rows[0]).toEqual({
      objectStatus: "deleting",
      eventStatus: "failed",
      attempts: 1,
      lastError: "Storage provider delete failed"
    });
    expect(failed.rows[0].lastError).not.toContain(sentinel);
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

  it("authorizes every private chat download without exposing the object key", async () => {
    const sender = await authedClient();
    const recipient = await authedClient();
    const outsider = await authedClient();
    const conversationId = await createConversation(
      sender.userId,
      recipient.userId
    );
    const response = await sender.upload("chat_attachment", await png());
    const privateUrl = response.body.upload.url as string;
    const privatePath = backendPath(privateUrl);

    expect(privateUrl).toBe(buildPrivateMediaUrl(response.body.upload.id));
    expect(privateUrl).not.toContain(sender.userId);
    expect((await sender.get(privatePath)).status).toBe(200);
    expect((await recipient.get(privatePath)).status).toBe(404);
    expect((await request(app).get(`/storage/public/${response.body.upload.id}`)).status).toBe(404);

    const message = await sendMessage({
      conversationId,
      senderId: sender.userId,
      body: "Processed attachment",
      attachmentUploadId: response.body.upload.id
    });
    expect(message.attachmentUrl).toBe(privateUrl);

    const object = await pool.query<{ status: string; objectKey: string }>(
      `select status, object_key as "objectKey" from storage_objects where id = $1`,
      [response.body.upload.id]
    );
    expect(object.rows[0].status).toBe("attached");
    expect(privateUrl).not.toContain(object.rows[0].objectKey);

    const senderRead = await sender.get(privatePath);
    expect(senderRead.status).toBe(200);
    expect(senderRead.headers["content-type"]).toMatch(/^image\/webp/);
    expect(senderRead.headers["cache-control"]).toBe("private, no-store");
    expect(senderRead.headers["cross-origin-resource-policy"]).toBe("same-origin");
    const recipientHead = await recipient.head(privatePath);
    expect(recipientHead.status).toBe(200);
    expect(Number(recipientHead.headers["content-length"])).toBeGreaterThan(0);
    expect((await recipient.get(privatePath)).status).toBe(200);
    const outsiderRead = await outsider.get(privatePath);
    expect(outsiderRead.status).toBe(404);
    expect(outsiderRead.headers["cache-control"]).toBe("private, no-store");
    expect((await outsider.head(privatePath)).status).toBe(404);
    expect((await outsider.get("/storage/private/not-a-uuid")).status).toBe(404);
    const anonymousRead = await request(app).get(privatePath);
    expect(anonymousRead.status).toBe(401);
    expect(anonymousRead.headers["cache-control"]).toBe("private, no-store");
    expect((await request(app).get(`/uploads/${object.rows[0].objectKey}`)).status).toBe(404);

    await pool.query(
      `update messages set attachment_url = $2 where id = $1`,
      [message.id, `/uploads/${object.rows[0].objectKey}`]
    );
    const page = await recipient.get(`/chat/conversations/${conversationId}/messages`);
    expect(page.status).toBe(200);
    expect(page.body.messages[0].attachmentUrl).toBe(privateUrl);

    await pool.query(
      `update messages set attachment_storage_object_id = null where id = $1`,
      [message.id]
    );
    const unmanagedLegacyPage = await recipient.get(
      `/chat/conversations/${conversationId}/messages`
    );
    expect(unmanagedLegacyPage.status).toBe(200);
    expect(unmanagedLegacyPage.body.messages[0].attachmentUrl).toBeNull();
    expect((await recipient.get(privatePath)).status).toBe(404);
  });

  it("bounds local reads and returns sanitized no-store provider failures", async () => {
    const owner = await authedClient();
    const uploaded = await owner.upload("chat_attachment", await png());
    const stored = await pool.query<{ objectKey: string }>(
      `select object_key as "objectKey" from storage_objects where id = $1`,
      [uploaded.body.upload.id]
    );
    const objectKey = stored.rows[0].objectKey;
    const file = path.resolve(env.LOCAL_UPLOAD_DIR, ...objectKey.split("/"));

    await fs.appendFile(file, Buffer.from([0]));
    const oversized = await owner.get(backendPath(uploaded.body.upload.url));
    expect(oversized.status).toBe(503);
    expect(oversized.headers["cache-control"]).toBe("private, no-store");
    expect(JSON.stringify(oversized.body)).not.toContain(objectKey);

    await fs.unlink(file);

    const response = await owner.get(backendPath(uploaded.body.upload.url));
    expect(response.status).toBe(503);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.body.error.message).toBe("Media is temporarily unavailable");
    expect(JSON.stringify(response.body)).not.toContain(objectKey);

    const head = await owner.head(backendPath(uploaded.body.upload.url));
    expect(head.status).toBe(503);
    expect(head.headers["cache-control"]).toBe("private, no-store");
  });

  it("never serves quarantined storage objects", async () => {
    const owner = await authedClient();
    const uploaded = await owner.upload("chat_attachment", await png());
    const privatePath = backendPath(uploaded.body.upload.url);

    await pool.query(
      `update storage_objects set status = 'quarantined' where id = $1`,
      [uploaded.body.upload.id]
    );

    expect((await owner.get(privatePath)).status).toBe(404);
    expect(
      (await request(app).get(`/storage/public/${uploaded.body.upload.id}`)).status
    ).toBe(404);
  });

  it("attaches avatar replacement transactionally and deletes the old object through outbox", async () => {
    const owner = await authedClient();
    const first = await owner.upload("avatar", await png());
    const firstAttach = await owner
      .patch("/users/me")
      .send({ avatarUploadId: first.body.upload.id });
    expect(firstAttach.status).toBe(200);
    expect(first.body.upload.url).toBe(buildPrivateMediaUrl(first.body.upload.id));
    expect(firstAttach.body.user.avatarUrl).toBe(buildPublicMediaUrl(first.body.upload.id));
    const firstPublicRead = await request(app).get(
      backendPath(firstAttach.body.user.avatarUrl)
    );
    expect(firstPublicRead.status).toBe(200);
    expect(firstPublicRead.headers["cache-control"]).toBe("public, max-age=300");
    const firstPublicHead = await request(app).head(
      backendPath(firstAttach.body.user.avatarUrl)
    );
    expect(firstPublicHead.status).toBe(200);
    expect(firstPublicHead.headers["content-length"]).toBe(
      firstPublicRead.headers["content-length"]
    );
    const firstObject = await pool.query<{ objectKey: string }>(
      `select object_key as "objectKey" from storage_objects where id = $1`,
      [first.body.upload.id]
    );
    const legacyPublicPath = `/uploads/${firstObject.rows[0].objectKey}`;
    expect((await request(app).get(legacyPublicPath)).status).toBe(200);
    expect((await request(app).head(legacyPublicPath)).status).toBe(200);

    const second = await owner.upload("avatar", await png(24, 24));
    const secondAttach = await owner
      .patch("/users/me")
      .send({ avatarUploadId: second.body.upload.id });
    expect(secondAttach.status).toBe(200);
    expect(secondAttach.body.user.avatarUrl).toBe(buildPublicMediaUrl(second.body.upload.id));

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

  it("publishes only active catalog references and cleans only unbound assets", async () => {
    const admin = await authedClient("admin");
    const otherAdmin = await authedClient("admin");
    const outsider = await authedClient();
    const uploaded = await admin.upload("catalog_asset", await png());
    const attached = await admin
      .post(`/storage/catalog-assets/${uploaded.body.upload.id}/attach`)
      .send({});
    expect(attached.status).toBe(200);
    const publicPath = backendPath(attached.body.upload.url);
    const previewPath = backendPath(attached.body.upload.previewUrl);
    expect(attached.body.upload.url).toBe(
      buildPublicMediaUrl(uploaded.body.upload.id)
    );
    expect(attached.body.upload.previewUrl).toBe(
      buildPrivateMediaUrl(uploaded.body.upload.id)
    );
    expect((await request(app).get(publicPath)).status).toBe(404);
    expect((await admin.get(previewPath)).status).toBe(200);
    expect((await otherAdmin.get(previewPath)).status).toBe(404);
    expect((await outsider.get(previewPath)).status).toBe(404);
    expect((await request(app).get(previewPath)).status).toBe(401);

    const group = await pool.query<{ id: string; icon: string }>(
      `insert into catalog_groups(slug, name, icon, status)
       values ($1, 'Stage 5 bound asset', $2, 'draft')
       returning id, icon`,
      [`stage5-${uploaded.body.upload.id}`, attached.body.upload.url]
    );
    expect(group.rows[0].icon).toBe(attached.body.upload.url);
    expect(group.rows[0].icon).not.toContain("/private/");
    expect((await request(app).get(publicPath)).status).toBe(404);
    expect((await admin.get(previewPath)).status).toBe(200);

    await pool.query(
      `update storage_objects set created_at = now() - interval '2 hours' where id = $1`,
      [uploaded.body.upload.id]
    );
    await expect(
      cleanupTemporaryStorageObjects({ olderThanHours: 1, batchSize: 10 })
    ).resolves.toMatchObject({ claimed: 0, queued: 0, failed: 0 });

    await pool.query(`update catalog_groups set status = 'active' where id = $1`, [
      group.rows[0].id
    ]);
    expect((await request(app).get(publicPath)).status).toBe(200);

    const itemUpload = await admin.upload("catalog_asset", await png(18, 18));
    const itemAttached = await admin
      .post(`/storage/catalog-assets/${itemUpload.body.upload.id}/attach`)
      .send({});
    expect(itemAttached.status).toBe(200);
    const itemPublicPath = backendPath(itemAttached.body.upload.url);
    const itemPreviewPath = backendPath(itemAttached.body.upload.previewUrl);
    const item = await pool.query<{ id: string }>(
      `insert into games(group_id, slug, name, icon_url, status)
       values ($1, $2, 'Stage 5 catalog item', $3, 'draft')
       returning id`,
      [
        group.rows[0].id,
        `stage5-item-${itemUpload.body.upload.id}`,
        itemAttached.body.upload.url
      ]
    );
    expect((await request(app).get(itemPublicPath)).status).toBe(404);
    expect((await admin.get(itemPreviewPath)).status).toBe(200);

    await pool.query(`update games set status = 'active' where id = $1`, [
      item.rows[0].id
    ]);
    expect((await request(app).get(itemPublicPath)).status).toBe(200);
    await pool.query(`update catalog_groups set status = 'hidden' where id = $1`, [
      group.rows[0].id
    ]);
    expect((await request(app).get(itemPublicPath)).status).toBe(404);
    await pool.query(`update catalog_groups set status = 'active' where id = $1`, [
      group.rows[0].id
    ]);
    expect((await request(app).get(itemPublicPath)).status).toBe(200);

    await pool.query(`update catalog_groups set icon = null where id = $1`, [
      group.rows[0].id
    ]);
    await expect(
      cleanupTemporaryStorageObjects({ olderThanHours: 1, batchSize: 10 })
    ).resolves.toMatchObject({ claimed: 1, queued: 1, failed: 0 });
    await expect(
      processOutboxBatch({ workerId: "catalog-orphan-cleanup" })
    ).resolves.toMatchObject({ processed: 1, failed: 0 });
    const cleaned = await pool.query<{ status: string }>(
      `select status from storage_objects where id = $1`,
      [uploaded.body.upload.id]
    );
    expect(cleaned.rows[0].status).toBe("deleted");
  });

  it("rolls a chat attachment back to temporary when message insertion fails", async () => {
    const sender = await authedClient();
    const recipient = await authedClient();
    const conversationId = await createConversation(
      sender.userId,
      recipient.userId
    );
    const uploaded = await sender.upload("chat_attachment", await png());

    await pool.query(`
      create or replace function test_fail_chat_attachment_insert()
      returns trigger as $$
      begin
        raise exception 'chat attachment insert failure';
      end;
      $$ language plpgsql;
      create trigger test_fail_chat_attachment_insert_trigger
      before insert on messages
      for each row execute function test_fail_chat_attachment_insert();
    `);
    try {
      await expect(
        sendMessage({
          conversationId,
          senderId: sender.userId,
          body: "This insert must roll back",
          attachmentUploadId: uploaded.body.upload.id
        })
      ).rejects.toThrow("chat attachment insert failure");
    } finally {
      await pool.query(`
        drop trigger if exists test_fail_chat_attachment_insert_trigger on messages;
        drop function if exists test_fail_chat_attachment_insert();
      `);
    }

    const object = await pool.query<{ status: string }>(
      `select status from storage_objects where id = $1`,
      [uploaded.body.upload.id]
    );
    expect(object.rows[0].status).toBe("temporary");
    expect(
      (await recipient.get(backendPath(uploaded.body.upload.url))).status
    ).toBe(404);
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
