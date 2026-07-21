import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import sharp from "sharp";

// Low per-user ceiling, effectively unlimited IP ceiling: the whole suite shares one
// supertest IP, so only the user bucket is exercised. Must be set before the app's
// module graph reads config/env.
process.env.UPLOAD_RATE_LIMIT_PER_MIN = "2";
process.env.UPLOAD_RATE_LIMIT_PER_IP = "100000";

const { createApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { getRedis } = await import("../src/common/redis.js");
const { issueSession } = await import("../src/modules/auth/session.service.js");
const { closeDb, createUser, resetDb } = await import("./fixtures.js");

const app = createApp();

beforeEach(async () => {
  await resetDb();
  const redis = getRedis();
  if (redis) {
    const keys = await redis.keys("rl:upload:*");
    if (keys.length) await redis.del(...keys);
  }
});
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
    upload: (buffer: Buffer) =>
      request(app)
        .post("/storage/upload")
        .set("Cookie", cookie)
        .set("X-CSRF-Token", session.csrfToken)
        .field("purpose", "avatar")
        .attach("file", buffer, { filename: "image.png", contentType: "image/png" })
  };
}

async function png() {
  return sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 9, g: 9, b: 9 } } })
    .png()
    .toBuffer();
}

describe("upload rate limit", () => {
  it("limits per user with Retry-After and leaves other users unaffected", async () => {
    const image = await png();
    const alice = await authedClient();
    const bob = await authedClient();

    expect((await alice.upload(image)).status).toBe(201);
    expect((await alice.upload(image)).status).toBe(201);

    const limited = await alice.upload(image);
    expect(limited.status).toBe(429);
    const retryAfter = Number(limited.headers["retry-after"]);
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThan(0);

    // No object row was created for the limited request.
    const rows = await pool.query<{ count: number }>(
      `select count(*)::int as count from storage_objects where owner_id = $1`,
      [alice.userId]
    );
    expect(rows.rows[0].count).toBe(2);

    expect((await bob.upload(image)).status).toBe(201);
  });
});
