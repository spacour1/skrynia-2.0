import bcrypt from "bcryptjs";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import request, { type Response } from "supertest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { getRedis } from "../src/common/redis.js";
import {
  DUMMY_PASSWORD_HASH,
  PASSWORD_BCRYPT_ROUNDS,
  hashPassword,
  newPasswordSchema,
  verifyPassword
} from "../src/modules/auth/password.service.js";
import { createPasswordResetToken } from "../src/modules/auth/verification.service.js";
import { closeDb, resetDb } from "./fixtures.js";

const app = createApp();

beforeEach(resetDb);
afterAll(async () => {
  await getRedis()?.quit();
  await closeDb();
});

function sessionCookies(response: Response) {
  const setCookie = response.headers["set-cookie"] as unknown as string[];
  return {
    cookie: setCookie.map((value) => value.split(";", 1)[0]),
    csrf: setCookie
      .find((value) => value.startsWith("csrf_token="))!
      .split(";", 1)[0]
      .split("=", 2)[1]
  };
}

describe("new password policy", () => {
  it("uses Unicode code points without imposing composition rules", () => {
    expect(newPasswordSchema.parse("длинная пароль-фраза")).toBe("длинная пароль-фраза");
    expect(newPasswordSchema.safeParse("😀😀😀😀").success).toBe(false);
    expect(newPasswordSchema.safeParse("lowercase-password1!").success).toBe(true);
  });

  it("normalizes new passwords to NFC before hashing", async () => {
    const decomposed = "A\u0301bcdefghij1!";
    const composed = decomposed.normalize("NFC");
    expect(newPasswordSchema.parse(decomposed)).toBe(composed);

    const hash = await hashPassword(decomposed);
    await expect(verifyPassword(composed, hash)).resolves.toBe(true);
    await expect(verifyPassword(decomposed, hash)).resolves.toBe(true);
  });

  it("rejects input beyond bcrypt's 72 UTF-8 byte boundary", () => {
    expect(newPasswordSchema.safeParse(`A1!${"a".repeat(69)}`).success).toBe(true);
    expect(newPasswordSchema.safeParse(`A1!${"a".repeat(70)}`).success).toBe(false);
    expect(newPasswordSchema.safeParse(`A1!${"😀".repeat(18)}`).success).toBe(false);
  });

  it("keeps a raw fallback for legacy non-NFC password hashes", async () => {
    const legacyRaw = "A\u0301bcdefghij1!";
    const legacyHash = await bcrypt.hash(legacyRaw, 4);
    await expect(verifyPassword(legacyRaw, legacyHash)).resolves.toBe(true);
  });
});

describe("login timing class", () => {
  it("performs one cost-12 bcrypt comparison and returns the same error for unknown and wrong-password accounts", async () => {
    const email = "known-login-timing@test.local";
    const passwordHash = await hashPassword("KnownPassword1!");
    await pool.query(
      `insert into users(email, password_hash, display_name, role)
       values ($1, $2, 'Timing User', 'user')`,
      [email, passwordHash]
    );

    const compareSpy = vi.spyOn(bcrypt, "compare");
    const wrong = await request(app)
      .post("/auth/login")
      .send({ email, password: "WrongPassword1!" });
    const wrongCalls = compareSpy.mock.calls.slice();
    compareSpy.mockClear();

    const unknown = await request(app)
      .post("/auth/login")
      .send({ email: "unknown-login-timing@test.local", password: "WrongPassword1!" });
    const unknownCalls = compareSpy.mock.calls.slice();
    compareSpy.mockRestore();

    expect(wrong.status).toBe(400);
    expect(unknown.status).toBe(400);
    expect(wrong.body.error).toMatchObject({ code: "bad_request", message: "Invalid email or password" });
    expect(unknown.body.error).toMatchObject({ code: "bad_request", message: "Invalid email or password" });
    expect(wrong.headers["set-cookie"]).toBeUndefined();
    expect(unknown.headers["set-cookie"]).toBeUndefined();
    expect(wrongCalls).toHaveLength(1);
    expect(unknownCalls).toHaveLength(1);
    expect(bcrypt.getRounds(String(wrongCalls[0][1]))).toBe(PASSWORD_BCRYPT_ROUNDS);
    expect(bcrypt.getRounds(String(unknownCalls[0][1]))).toBe(PASSWORD_BCRYPT_ROUNDS);
    expect(unknownCalls[0][1]).toBe(DUMMY_PASSWORD_HASH);
  });

  it("checks a banned user's password before revealing the ban", async () => {
    const email = "banned-login-timing@test.local";
    const password = "BannedPassword1!";
    await pool.query(
      `insert into users(email, password_hash, display_name, role, is_banned)
       values ($1, $2, 'Banned User', 'user', true)`,
      [email, await hashPassword(password)]
    );

    await request(app)
      .post("/auth/login")
      .send({ email, password: "WrongPassword1!" })
      .expect(400);
    await request(app)
      .post("/auth/login")
      .send({ email, password })
      .expect(403);
  });
});

describe("shared password policy at HTTP boundaries", () => {
  it("applies the same schema to register, reset and authenticated change without burning a rejected reset token", async () => {
    const email = "shared-password-policy@test.local";
    const currentPassword = "long lowercase passphrase";
    const tooShort = "Short1!";

    await request(app)
      .post("/auth/register")
      .send({ email, password: tooShort, displayName: "Policy User" })
      .expect(400);

    const registered = await request(app)
      .post("/auth/register")
      .send({ email, password: currentPassword, displayName: "Policy User" })
      .expect(201);
    const session = sessionCookies(registered);

    await request(app)
      .post("/users/me/password")
      .set("Cookie", session.cookie)
      .set("X-CSRF-Token", session.csrf)
      .send({ currentPassword, newPassword: tooShort })
      .expect(400);

    const token = await createPasswordResetToken(registered.body.user.id as string);
    await request(app)
      .post("/auth/password/reset")
      .send({ token, password: tooShort })
      .expect(400);
    await request(app)
      .post("/auth/password/reset")
      .send({ token, password: "another long passphrase" })
      .expect(200);
  });
});

describe("password reset generation CAS", () => {
  it("lets exactly one concurrent reset win and advances both durable epochs once", async () => {
    const email = "concurrent-password-reset@test.local";
    await pool.query(
      `insert into users(email, password_hash, display_name, role)
       values ($1, $2, 'Concurrent Reset', 'user')`,
      [email, await hashPassword("Original long passphrase")]
    );
    const user = await pool.query<{ id: string }>(
      `select id from users where email = $1`,
      [email]
    );
    const token = await createPasswordResetToken(user.rows[0].id);
    const candidates = ["First replacement passphrase", "Second replacement passphrase"];

    const responses = await Promise.all(
      candidates.map((password) =>
        request(app).post("/auth/password/reset").send({ token, password })
      )
    );
    expect(responses.map((response) => response.status).sort()).toEqual([200, 400]);

    const state = await pool.query<{
      passwordGeneration: number;
      sessionVersion: number;
    }>(
      `select password_generation as "passwordGeneration",
              session_version as "sessionVersion"
       from users
       where id = $1`,
      [user.rows[0].id]
    );
    expect(state.rows[0]).toEqual({ passwordGeneration: 3, sessionVersion: 2 });

    const winningIndex = responses.findIndex((response) => response.status === 200);
    const losingIndex = winningIndex === 0 ? 1 : 0;
    await request(app)
      .post("/auth/login")
      .send({ email, password: candidates[winningIndex] })
      .expect(200);
    await request(app)
      .post("/auth/login")
      .send({ email, password: candidates[losingIndex] })
      .expect(400);
  });

  it("rejects a reset token issued before an authenticated password change", async () => {
    const email = "stale-password-reset@test.local";
    const currentPassword = "Current long passphrase";
    const changedPassword = "Changed long passphrase";
    const registered = await request(app)
      .post("/auth/register")
      .send({ email, password: currentPassword, displayName: "Stale Reset" })
      .expect(201);
    const session = sessionCookies(registered);
    const token = await createPasswordResetToken(registered.body.user.id as string);

    await request(app)
      .post("/users/me/password")
      .set("Cookie", session.cookie)
      .set("X-CSRF-Token", session.csrf)
      .send({ currentPassword, newPassword: changedPassword })
      .expect(200);
    await request(app)
      .post("/auth/password/reset")
      .send({ token, password: "Attacker replacement passphrase" })
      .expect(400);

    await request(app)
      .post("/auth/login")
      .send({ email, password: changedPassword })
      .expect(200);
    await request(app)
      .post("/auth/login")
      .send({ email, password: "Attacker replacement passphrase" })
      .expect(400);
  });

  it("rejects reset credentials bound to an old email identity", async () => {
    const oldEmail = "old-reset-recipient@test.local";
    const newEmail = "new-reset-recipient@test.local";
    const currentPassword = "Current reset identity passphrase";
    const user = await pool.query<{ id: string }>(
      `insert into users(email, password_hash, display_name, role)
       values ($1, $2, 'Reset Identity', 'user')
       returning id`,
      [oldEmail, await hashPassword(currentPassword)]
    );
    const userId = user.rows[0].id;
    const oldToken = await createPasswordResetToken(userId, oldEmail);

    await pool.query(
      `update users
       set email = $2, email_generation = email_generation + 1
       where id = $1`,
      [userId, newEmail]
    );

    await request(app)
      .post("/auth/password/reset")
      .send({ token: oldToken, password: "Rejected old-recipient passphrase" })
      .expect(400);
    await expect(createPasswordResetToken(userId, oldEmail)).rejects.toThrow(
      /account is unavailable/i
    );

    const currentToken = await createPasswordResetToken(userId, newEmail);
    await request(app)
      .post("/auth/password/reset")
      .send({ token: currentToken, password: "Accepted new-recipient passphrase" })
      .expect(200);
  });

  it("lets a newer reset issuance cancel an older request already hashing", async () => {
    const email = "inflight-reset-supersede@test.local";
    const user = await pool.query<{ id: string }>(
      `insert into users(email, password_hash, display_name, role)
       values ($1, $2, 'Inflight Reset', 'user')
       returning id`,
      [email, await hashPassword("Original inflight reset passphrase")]
    );
    const oldToken = await createPasswordResetToken(user.rows[0].id, email);
    const discardedHash = await hashPassword("Discarded inflight reset passphrase");
    let announceHashStarted!: () => void;
    let releaseHash!: () => void;
    const hashStarted = new Promise<void>((resolve) => {
      announceHashStarted = resolve;
    });
    const hashRelease = new Promise<void>((resolve) => {
      releaseHash = resolve;
    });
    const hashSpy = vi.spyOn(bcrypt, "hash").mockImplementationOnce(async () => {
      announceHashStarted();
      await hashRelease;
      return discardedHash;
    });

    const oldRequest = request(app)
      .post("/auth/password/reset")
      .send({ token: oldToken, password: "Older inflight reset passphrase" })
      .then((response) => response);
    await hashStarted;
    const newerToken = await createPasswordResetToken(user.rows[0].id, email);
    releaseHash();
    const oldResponse = await oldRequest;
    hashSpy.mockRestore();

    expect(oldResponse.status).toBe(400);
    await request(app)
      .post("/auth/password/reset")
      .send({ token: newerToken, password: "Newer inflight reset passphrase" })
      .expect(200);
  });

  it("prevents an authenticated change verified before reset from overwriting it", async () => {
    const email = "stale-authenticated-change@test.local";
    const currentPassword = "Current authenticated change passphrase";
    const resetPassword = "Recovery reset wins passphrase";
    const registered = await request(app)
      .post("/auth/register")
      .send({ email, password: currentPassword, displayName: "Stale Change" })
      .expect(201);
    const session = sessionCookies(registered);
    let announceCompareStarted!: () => void;
    let releaseCompare!: () => void;
    const compareStarted = new Promise<void>((resolve) => {
      announceCompareStarted = resolve;
    });
    const compareRelease = new Promise<void>((resolve) => {
      releaseCompare = resolve;
    });
    const compareSpy = vi.spyOn(bcrypt, "compare").mockImplementationOnce(async () => {
      announceCompareStarted();
      await compareRelease;
      return true;
    });

    const staleChange = request(app)
      .post("/users/me/password")
      .set("Cookie", session.cookie)
      .set("X-CSRF-Token", session.csrf)
      .send({ currentPassword, newPassword: "Stale authenticated change passphrase" })
      .then((response) => response);
    await compareStarted;
    const resetToken = await createPasswordResetToken(registered.body.user.id as string, email);
    await request(app)
      .post("/auth/password/reset")
      .send({ token: resetToken, password: resetPassword })
      .expect(200);
    releaseCompare();
    const staleResponse = await staleChange;
    compareSpy.mockRestore();

    expect(staleResponse.status).toBe(400);
    await request(app)
      .post("/auth/login")
      .send({ email, password: resetPassword })
      .expect(200);
    await request(app)
      .post("/auth/login")
      .send({ email, password: "Stale authenticated change passphrase" })
      .expect(400);
  });

  it("returns the same forgot-password response when Redis fails for an existing account", async () => {
    const email = "forgot-redis-failure@test.local";
    await pool.query(
      `insert into users(email, password_hash, display_name, role)
       values ($1, $2, 'Forgot Failure', 'user')`,
      [email, await hashPassword("Existing long passphrase")]
    );
    const redis = getRedis()!;
    const evalSpy = vi.spyOn(redis, "eval").mockRejectedValueOnce(new Error("injected Redis failure"));

    const existing = await request(app)
      .post("/auth/password/forgot")
      .send({ email });
    evalSpy.mockRestore();
    const unknown = await request(app)
      .post("/auth/password/forgot")
      .send({ email: "unknown-forgot-redis@test.local" });

    expect(existing.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(existing.body).toEqual({ status: "sent" });
    expect(unknown.body).toEqual({ status: "sent" });
  });
});
