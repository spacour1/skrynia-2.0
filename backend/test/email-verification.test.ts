import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { pool } from "../src/db/pool.js";
import { getRedis } from "../src/common/redis.js";
import { requireEmailVerified } from "../src/common/middleware/require-email-verified.js";
import {
  createEmailVerificationToken,
  consumeEmailVerificationToken,
  checkResendRateLimit
} from "../src/modules/auth/verification.service.js";
import { closeDb, createUser, resetDb } from "./fixtures.js";

const EMAIL_VERIFIED_EXPR = `(email_verified_at is not null or telegram_id is not null) as "emailVerified"`;

beforeEach(resetDb);
afterAll(async () => {
  await getRedis()?.quit();
  await closeDb();
});

async function isEmailVerified(userId: string) {
  const result = await pool.query<{ emailVerified: boolean }>(
    `select ${EMAIL_VERIFIED_EXPR} from users where id = $1`,
    [userId]
  );
  return result.rows[0].emailVerified;
}

describe("computed emailVerified flag", () => {
  it("is false for a freshly created email/password user", async () => {
    const userId = await createUser();
    expect(await isEmailVerified(userId)).toBe(false);
  });

  it("becomes true once email_verified_at is set", async () => {
    const userId = await createUser();
    await pool.query(`update users set email_verified_at = now() where id = $1`, [userId]);
    expect(await isEmailVerified(userId)).toBe(true);
  });

  it("is true automatically for telegram-only accounts, even with no email_verified_at", async () => {
    const result = await pool.query<{ id: string }>(
      `insert into users(email, display_name, role, telegram_id) values ($1, 'Telegram User', 'user', $2) returning id`,
      ["tg_999@telegram.local", "999"]
    );
    expect(await isEmailVerified(result.rows[0].id)).toBe(true);
  });
});

describe("requireEmailVerified middleware", () => {
  function mockReqRes(emailVerified: boolean) {
    const req = { user: { id: "u1", emailVerified } };
    const res = {};
    const next = vi.fn();
    return { req, res, next };
  }

  it("calls next() with no error when the user is verified", () => {
    const { req, res, next } = mockReqRes(true);
    requireEmailVerified(req as any, res as any, next);
    expect(next).toHaveBeenCalledWith();
  });

  it("calls next(error) with a 403 email_not_verified error when unverified", () => {
    const { req, res, next } = mockReqRes(false);
    requireEmailVerified(req as any, res as any, next);
    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0][0];
    expect(error.status).toBe(403);
    expect(error.code).toBe("email_not_verified");
  });

  it("rejects with 401 when there is no authenticated user at all", () => {
    const res = {};
    const next = vi.fn();
    requireEmailVerified({} as any, res as any, next);
    const error = next.mock.calls[0][0];
    expect(error.status).toBe(401);
  });
});

describe("email verification token lifecycle", () => {
  it("a freshly created token resolves to the user id that requested it", async () => {
    const userId = await createUser();
    const token = await createEmailVerificationToken(userId);
    const resolved = await consumeEmailVerificationToken(token);
    expect(resolved).toBe(userId);
  });

  it("consuming the same token twice fails the second time", async () => {
    const userId = await createUser();
    const token = await createEmailVerificationToken(userId);
    await consumeEmailVerificationToken(token);
    await expect(consumeEmailVerificationToken(token)).rejects.toThrow(/invalid or expired/i);
  });

  it("an unknown/invalid token is rejected", async () => {
    await expect(consumeEmailVerificationToken("not-a-real-token")).rejects.toThrow(/invalid or expired/i);
  });
});

describe("verification resend rate limit", () => {
  it("allows the first resend, then blocks a second one within 60 seconds", async () => {
    const userId = await createUser();
    await expect(checkResendRateLimit(userId)).resolves.toBeUndefined();
    await expect(checkResendRateLimit(userId)).rejects.toThrow(/wait a minute/i);
  });

  it("blocks after the hourly cap even with the cooldown manually cleared between calls", async () => {
    const userId = await createUser();
    const redis = getRedis()!;
    for (let i = 0; i < 5; i += 1) {
      await checkResendRateLimit(userId);
      await redis.del(`email_verify_cooldown:${userId}`);
    }
    await expect(checkResendRateLimit(userId)).rejects.toThrow(/too many/i);
  });
});
