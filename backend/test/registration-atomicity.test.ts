import { createHash, createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";

// The Telegram login route verifies an HMAC over the bot token, so the token must be
// present before src/config/env.js is first imported by the app module graph.
process.env.TELEGRAM_BOT_TOKEN = "test-telegram-bot-token";

const { createApp } = await import("../src/app.js");
const { pool } = await import("../src/db/pool.js");
const { getRedis } = await import("../src/common/redis.js");
const { closeDb, resetDb } = await import("./fixtures.js");

const app = createApp();

beforeEach(resetDb);
afterAll(async () => {
  await getRedis()?.quit();
  await closeDb();
});

function uniqueEmail() {
  return `${randomUUID()}@atomicity.local`;
}

async function getUserByEmail(email: string) {
  const result = await pool.query(`select id from users where email = $1`, [email]);
  return result.rows[0] ?? null;
}

async function getWallet(userId: string) {
  const result = await pool.query(`select id from wallets where user_id = $1 and currency = 'UAH'`, [userId]);
  return result.rows[0] ?? null;
}

/** Makes every wallet insert fail at the database level until dropped. */
async function injectWalletInsertFailure() {
  await pool.query(`
    create or replace function test_fail_wallet_insert() returns trigger as $$
    begin
      raise exception 'wallet insert failure injected by test';
    end $$ language plpgsql`);
  await pool.query(`
    create trigger test_fail_wallet_insert before insert on wallets
    for each row execute function test_fail_wallet_insert()`);
}

async function removeWalletInsertFailure() {
  await pool.query(`drop trigger if exists test_fail_wallet_insert on wallets`);
  await pool.query(`drop function if exists test_fail_wallet_insert()`);
}

function telegramLoginPayload(telegramId: string) {
  const fields: Record<string, string | number> = {
    id: telegramId,
    first_name: "Atomic",
    username: `atomic_${telegramId}`,
    auth_date: Math.floor(Date.now() / 1000)
  };
  const dataCheckString = Object.entries(fields)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHash("sha256").update(process.env.TELEGRAM_BOT_TOKEN!).digest();
  const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  return { ...fields, hash };
}

describe("email registration atomicity", () => {
  it("creates the user and the mandatory wallet together", async () => {
    const email = uniqueEmail();
    const response = await request(app)
      .post("/auth/register")
      .send({ email, password: "password-123", displayName: "Atomic User" });

    expect(response.status).toBe(201);
    const user = await getUserByEmail(email);
    expect(user).not.toBeNull();
    expect(await getWallet(user.id)).not.toBeNull();
    expect(response.headers["set-cookie"]).toBeDefined();
  });

  it("rolls the user back when the wallet insert fails and issues no session", async () => {
    const email = uniqueEmail();
    await injectWalletInsertFailure();
    try {
      const response = await request(app)
        .post("/auth/register")
        .send({ email, password: "password-123", displayName: "Atomic User" });

      expect(response.status).toBe(500);
      expect(response.headers["set-cookie"]).toBeUndefined();
      expect(await getUserByEmail(email)).toBeNull();
    } finally {
      await removeWalletInsertFailure();
    }
  });

  it("maps a duplicate email to 409 without creating a second account or session", async () => {
    const email = uniqueEmail();
    await request(app)
      .post("/auth/register")
      .send({ email, password: "password-123", displayName: "First" })
      .expect(201);

    const duplicate = await request(app)
      .post("/auth/register")
      .send({ email, password: "password-456", displayName: "Second" });

    expect(duplicate.status).toBe(409);
    expect(duplicate.headers["set-cookie"]).toBeUndefined();
    const rows = await pool.query(`select count(*)::int as count from users where email = $1`, [email]);
    expect(rows.rows[0].count).toBe(1);
  });

  it("registration still succeeds when the verification email cannot be sent", async () => {
    // RESEND_API_KEY is unset in the test environment, so the send path resolves
    // unsuccessfully; the committed account must be unaffected.
    const email = uniqueEmail();
    const response = await request(app)
      .post("/auth/register")
      .send({ email, password: "password-123", displayName: "Atomic User" });

    expect(response.status).toBe(201);
    expect(await getUserByEmail(email)).not.toBeNull();
  });
});

describe("telegram registration atomicity", () => {
  it("creates the user and wallet together for a new telegram account", async () => {
    const telegramId = String(Date.now());
    const response = await request(app).post("/auth/telegram").send(telegramLoginPayload(telegramId));

    expect(response.status).toBe(200);
    const user = await pool.query(`select id from users where telegram_id = $1`, [telegramId]);
    expect(user.rows[0]).toBeDefined();
    expect(await getWallet(user.rows[0].id)).not.toBeNull();
  });

  it("rolls the new telegram user back when the wallet insert fails", async () => {
    const telegramId = String(Date.now() + 1);
    await injectWalletInsertFailure();
    try {
      const response = await request(app).post("/auth/telegram").send(telegramLoginPayload(telegramId));

      expect(response.status).toBe(500);
      expect(response.headers["set-cookie"]).toBeUndefined();
      const user = await pool.query(`select id from users where telegram_id = $1`, [telegramId]);
      expect(user.rows[0]).toBeUndefined();
    } finally {
      await removeWalletInsertFailure();
    }
  });

  it("repeated telegram login reuses the account instead of duplicating it", async () => {
    const telegramId = String(Date.now() + 2);
    await request(app).post("/auth/telegram").send(telegramLoginPayload(telegramId)).expect(200);
    await request(app).post("/auth/telegram").send(telegramLoginPayload(telegramId)).expect(200);

    const rows = await pool.query(`select count(*)::int as count from users where telegram_id = $1`, [telegramId]);
    expect(rows.rows[0].count).toBe(1);
  });
});
