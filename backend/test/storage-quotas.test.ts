import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import sharp from "sharp";
import { createApp } from "../src/app.js";
import { env } from "../src/config/env.js";
import { pool } from "../src/db/pool.js";
import { getRedis } from "../src/common/redis.js";
import { issueSession } from "../src/modules/auth/session.service.js";
import { ProcessingSemaphore } from "../src/modules/storage/storage.service.js";
import { closeDb, createUser, resetDb } from "./fixtures.js";

const app = createApp();

beforeEach(resetDb);
afterAll(async () => {
  await getRedis()?.quit();
  await closeDb();
});

async function authedClient() {
  const userId = await createUser("user");
  const session = await issueSession(userId, "user");
  const cookie = [`access_token=${session.accessToken}`, `csrf_token=${session.csrfToken}`];
  return {
    userId,
    upload: (purpose: string, buffer: Buffer) =>
      request(app)
        .post("/storage/upload")
        .set("Cookie", cookie)
        .set("X-CSRF-Token", session.csrfToken)
        .field("purpose", purpose)
        .attach("file", buffer, { filename: "image.png", contentType: "image/png" })
  };
}

async function png(width = 20, height = 12) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 40, g: 90, b: 160 } }
  })
    .png()
    .toBuffer();
}

/** Seeds usage rows directly - quota checks read DB sums, no physical file needed. */
async function seedStorageUsage(
  ownerId: string,
  input: { sizeBytes: number; count?: number; ageHours?: number; purpose?: string; status?: string }
) {
  await pool.query(
    `insert into storage_objects(owner_id, object_key, storage_driver, purpose, mime_type,
                                 size_bytes, width, height, status, created_at, attached_at, deleted_at)
     select $1::uuid, 'seed/' || $1::text || '/' || gs || '-' || $6::text, 'local', $4::text, 'image/webp',
            $2::bigint, 10, 10, $5::text, now() - ($3::int * interval '1 hour'),
            case when $5::text = 'attached' then now() - ($3::int * interval '1 hour') end,
            case when $5::text = 'deleted' then now() - ($3::int * interval '1 hour') end
     from generate_series(1, $7::int) gs`,
    [
      ownerId,
      input.sizeBytes,
      input.ageHours ?? 0,
      input.purpose ?? "product_media",
      input.status ?? "attached",
      randomUUID().slice(0, 8),
      input.count ?? 1
    ]
  );
}

describe("upload quotas", () => {
  it("rejects an upload beyond the daily byte quota", async () => {
    const client = await authedClient();
    await seedStorageUsage(client.userId, { sizeBytes: env.STORAGE_DAILY_UPLOAD_BYTES_PER_USER });

    const response = await client.upload("avatar", await png());
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("storage_quota_exceeded");
    expect(response.body.error.message).toMatch(/Daily upload limit/);
  });

  it("deleted objects still consume the daily window", async () => {
    const client = await authedClient();
    await seedStorageUsage(client.userId, {
      sizeBytes: env.STORAGE_DAILY_UPLOAD_BYTES_PER_USER,
      status: "deleted"
    });

    const response = await client.upload("avatar", await png());
    expect(response.status).toBe(400);
    expect(response.body.error.message).toMatch(/Daily upload limit/);
  });

  it("rejects an upload beyond the total storage quota", async () => {
    const client = await authedClient();
    // Older than 24h so only the total quota triggers, not the daily one.
    await seedStorageUsage(client.userId, {
      sizeBytes: env.STORAGE_TOTAL_QUOTA_BYTES_PER_USER,
      ageHours: 48
    });

    const response = await client.upload("avatar", await png());
    expect(response.status).toBe(400);
    expect(response.body.error.message).toMatch(/Storage quota exceeded/);
  });

  it("deleting objects frees the total quota again", async () => {
    const client = await authedClient();
    await seedStorageUsage(client.userId, {
      sizeBytes: env.STORAGE_TOTAL_QUOTA_BYTES_PER_USER,
      ageHours: 48,
      status: "deleted"
    });

    const response = await client.upload("avatar", await png());
    expect(response.status).toBe(201);
  });

  it("rejects uploads past the per-purpose object ceiling", async () => {
    const client = await authedClient();
    await seedStorageUsage(client.userId, {
      sizeBytes: 100,
      count: env.STORAGE_MAX_OBJECTS_PER_PURPOSE,
      ageHours: 48,
      purpose: "avatar"
    });

    const rejected = await client.upload("avatar", await png());
    expect(rejected.status).toBe(400);
    expect(rejected.body.error.message).toMatch(/Too many stored objects/);

    // Another purpose is unaffected.
    const other = await client.upload("product_media", await png());
    expect(other.status).toBe(201);
  });

  it("parallel uploads cannot overshoot the purpose ceiling together", async () => {
    const client = await authedClient();
    await seedStorageUsage(client.userId, {
      sizeBytes: 100,
      count: env.STORAGE_MAX_OBJECTS_PER_PURPOSE - 1,
      ageHours: 48,
      purpose: "avatar"
    });

    const image = await png();
    const results = await Promise.all([
      client.upload("avatar", image),
      client.upload("avatar", image),
      client.upload("avatar", image),
      client.upload("avatar", image)
    ]);
    const succeeded = results.filter((r) => r.status === 201).length;
    const rejected = results.filter((r) => r.status === 400).length;
    expect(succeeded).toBe(1);
    expect(rejected).toBe(3);

    const count = await pool.query<{ count: number }>(
      `select count(*)::int as count from storage_objects
       where owner_id = $1 and purpose = 'avatar' and status in ('temporary', 'attached')`,
      [client.userId]
    );
    expect(count.rows[0].count).toBe(env.STORAGE_MAX_OBJECTS_PER_PURPOSE);
  });
});

describe("processing semaphore", () => {
  it("bounds concurrency and refuses work past the queue limit", async () => {
    const semaphore = new ProcessingSemaphore(1, 1);
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = semaphore.run(async () => {
      await firstGate;
      return "first";
    });
    // Give the first task a tick to occupy the slot.
    await new Promise((resolve) => setImmediate(resolve));

    const second = semaphore.run(async () => "second");
    await new Promise((resolve) => setImmediate(resolve));

    // Slot busy + queue full: the third caller is refused instead of buffering.
    await expect(semaphore.run(async () => "third")).rejects.toMatchObject({ status: 503 });

    releaseFirst();
    expect(await first).toBe("first");
    expect(await second).toBe("second");
  });
});
