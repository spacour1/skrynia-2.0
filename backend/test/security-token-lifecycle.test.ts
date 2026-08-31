import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { pool } from "../src/db/pool.js";
import { getRedis } from "../src/common/redis.js";
import {
  createEmailVerificationToken,
  checkResendRateLimit,
  consumeEmailVerificationToken,
  createPasswordResetToken,
  consumePasswordResetToken
} from "../src/modules/auth/verification.service.js";
import { confirmEmailChange } from "../src/modules/auth/email-change.service.js";
import { closeDb, createUser, resetDb } from "./fixtures.js";

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function emailTokenKey(token: string) {
  return `email_verify:${tokenHash(token)}`;
}

function resetTokenKey(token: string) {
  return `pwd_reset:${tokenHash(token)}`;
}

beforeEach(resetDb);
afterAll(async () => {
  await getRedis()?.quit();
  await closeDb();
});

describe("generation-bound security token lifecycle", () => {
  it("allows exactly one concurrent consumer for an email-verification token", async () => {
    const userId = await createUser();
    const user = await pool.query<{ email: string }>(
      `select email from users where id = $1`,
      [userId]
    );
    const token = await createEmailVerificationToken(userId, user.rows[0].email);

    const results = await Promise.allSettled([
      consumeEmailVerificationToken(token),
      consumeEmailVerificationToken(token)
    ]);
    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof consumeEmailVerificationToken>>> =>
        result.status === "fulfilled"
    );
    const rejected = results.filter((result) => result.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(fulfilled[0].value).toMatchObject({
      version: 1,
      purpose: "email_verification",
      userId,
      expectedEmail: user.rows[0].email,
      emailGeneration: 1
    });
  });

  it("allows exactly one concurrent consumer for the active password-reset token", async () => {
    const userId = await createUser();
    const token = await createPasswordResetToken(userId);

    const results = await Promise.allSettled([
      consumePasswordResetToken(token),
      consumePasswordResetToken(token)
    ]);
    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof consumePasswordResetToken>>> =>
        result.status === "fulfilled"
    );

    expect(fulfilled).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(fulfilled[0].value).toMatchObject({
      version: 1,
      purpose: "password_reset",
      userId,
      emailGeneration: 1,
      passwordGeneration: 2
    });
  });

  it("atomically supersedes a user's previous reset token", async () => {
    const userId = await createUser();
    const first = await createPasswordResetToken(userId);
    const second = await createPasswordResetToken(userId);

    await expect(consumePasswordResetToken(first)).rejects.toThrow(/invalid or expired/i);
    await expect(consumePasswordResetToken(second)).resolves.toMatchObject({
      userId,
      emailGeneration: 1,
      passwordGeneration: 3
    });
  });

  it("fails closed for malformed, wrong-purpose, and logically expired records", async () => {
    const redis = getRedis()!;
    const userId = await createUser();

    const malformedToken = await createEmailVerificationToken(userId);
    await redis.set(emailTokenKey(malformedToken), "{not-json", "EX", 60);
    await expect(consumeEmailVerificationToken(malformedToken)).rejects.toThrow(
      /invalid or expired/i
    );
    expect(await redis.get(emailTokenKey(malformedToken))).toBeNull();

    const wrongPurposeToken = await createEmailVerificationToken(userId);
    const wrongPurposeKey = emailTokenKey(wrongPurposeToken);
    const wrongPurposeRecord = JSON.parse((await redis.get(wrongPurposeKey))!);
    wrongPurposeRecord.purpose = "password_reset";
    await redis.set(wrongPurposeKey, JSON.stringify(wrongPurposeRecord), "EX", 60);
    await expect(consumeEmailVerificationToken(wrongPurposeToken)).rejects.toThrow(
      /invalid or expired/i
    );
    expect(await redis.get(wrongPurposeKey)).toBeNull();

    const expiredToken = await createEmailVerificationToken(userId);
    const expiredKey = emailTokenKey(expiredToken);
    const expiredRecord = JSON.parse((await redis.get(expiredKey))!);
    expiredRecord.expiresAt = Date.now() - 1;
    await redis.set(expiredKey, JSON.stringify(expiredRecord), "EX", 60);
    await expect(consumeEmailVerificationToken(expiredToken)).rejects.toThrow(
      /invalid or expired/i
    );
    expect(await redis.get(expiredKey)).toBeNull();
  });

  it("stores only token hashes and versioned identity records in Redis", async () => {
    const redis = getRedis()!;
    const userId = await createUser();
    const user = await pool.query<{ email: string }>(
      `select email from users where id = $1`,
      [userId]
    );

    const emailToken = await createEmailVerificationToken(userId);
    const emailKey = emailTokenKey(emailToken);
    const emailRecord = await redis.get(emailKey);
    expect(emailKey).not.toContain(emailToken);
    expect(emailRecord).not.toContain(emailToken);
    expect(JSON.parse(emailRecord!)).toMatchObject({
      version: 1,
      purpose: "email_verification",
      userId,
      expectedEmail: user.rows[0].email,
      emailGeneration: 1
    });

    const resetToken = await createPasswordResetToken(userId);
    const resetKey = resetTokenKey(resetToken);
    const resetRecord = await redis.get(resetKey);
    const activePointer = await redis.get(`pwd_reset_active:${userId}`);
    expect(resetKey).not.toContain(resetToken);
    expect(resetRecord).not.toContain(resetToken);
    expect(activePointer).toBe(`2:${tokenHash(resetToken)}`);
    expect(activePointer).not.toContain(resetToken);
    expect(JSON.parse(resetRecord!)).toMatchObject({
      version: 1,
      purpose: "password_reset",
      userId,
      expectedEmail: user.rows[0].email,
      emailGeneration: 1,
      passwordGeneration: 2
    });
  });

  it("enforces the resend cooldown atomically under concurrency", async () => {
    const userId = await createUser();
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => checkResendRateLimit(userId))
    );

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(4);
  });

  it("increments the durable email generation in the email-change activation transaction", async () => {
    const userId = await createUser();
    const token = randomBytes(32).toString("base64url");
    await pool.query(
      `insert into user_email_change_requests(
         user_id, pending_email, token_hash, requested_session_version,
         expires_at, delivery_confirmed
       )
       values ($1, $2, $3, 1, now() + interval '1 hour', true)`,
      [userId, "replacement@example.test", tokenHash(token)]
    );
    const revokeAllUserSessions = vi.fn(async () => undefined);

    await expect(
      confirmEmailChange(
        { token },
        { revokeAllUserSessions }
      )
    ).resolves.toMatchObject({
      userId,
      email: "replacement@example.test"
    });

    const changed = await pool.query<{
      email: string;
      emailGeneration: number;
      sessionVersion: number;
    }>(
      `select email, email_generation as "emailGeneration",
              session_version as "sessionVersion"
       from users
       where id = $1`,
      [userId]
    );
    expect(changed.rows[0]).toEqual({
      email: "replacement@example.test",
      emailGeneration: 2,
      sessionVersion: 2
    });
    expect(revokeAllUserSessions).toHaveBeenCalledOnce();
  });
});
