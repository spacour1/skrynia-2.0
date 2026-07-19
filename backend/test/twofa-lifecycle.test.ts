import bcrypt from "bcryptjs";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { getRedis } from "../src/common/redis.js";
import { pool } from "../src/db/pool.js";
import { issueSession } from "../src/modules/auth/session.service.js";
import {
  confirmTwoFactor,
  disableTwoFactor,
  migrateLegacyTwoFactorSecrets,
  regenerateTwoFactorBackupCodes,
  setupTwoFactor,
  verifyTwoFactorCode
} from "../src/modules/auth/twofa.service.js";
import {
  generateTotpCode,
  generateTotpSecret,
  verifyTotpCode
} from "../src/modules/auth/totp.service.js";
import { decryptTwoFactorSecret } from "../src/modules/auth/twofa-crypto.service.js";
import { closeDb, createUser, resetDb } from "./fixtures.js";

const PASSWORD = "CurrentPassword1!";
const app = createApp();

beforeEach(async () => {
  await resetDb();
  await pool.query(`delete from audit_logs where action like 'two_factor_%'`);
  await pool.query(`drop trigger if exists test_fail_two_factor_disable_audit on audit_logs`);
  await pool.query(`drop function if exists test_fail_two_factor_disable_audit()`);
});

afterAll(async () => {
  await getRedis()?.quit();
  await closeDb();
});

async function createPasswordUser() {
  const userId = await createUser();
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  await pool.query(`update users set password_hash = $2 where id = $1`, [userId, passwordHash]);
  return userId;
}

async function enableTwoFactor(userId: string) {
  const setup = await setupTwoFactor(userId, `${userId}@test.local`);
  const backupCodes = await confirmTwoFactor(userId, generateTotpCode(setup.secret));
  return { ...setup, backupCodes };
}

describe("secure two-factor lifecycle", () => {
  it("stores encrypted secrets and atomically replaces an active method after confirmation", async () => {
    const userId = await createPasswordUser();
    const initial = await enableTwoFactor(userId);
    const oldCode = generateTotpCode(initial.secret);

    await expect(
      setupTwoFactor(userId, `${userId}@test.local`)
    ).rejects.toThrow(/confirm this action/i);

    let replacement = await setupTwoFactor(
      userId,
      `${userId}@test.local`,
      { currentPassword: PASSWORD }
    );
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const pendingCode = generateTotpCode(replacement.secret);
      if (
        !verifyTotpCode(initial.secret, pendingCode) &&
        !verifyTotpCode(replacement.secret, oldCode)
      ) {
        break;
      }
      replacement = await setupTwoFactor(
        userId,
        `${userId}@test.local`,
        { currentPassword: PASSWORD }
      );
    }

    const pendingCode = generateTotpCode(replacement.secret);
    expect(await verifyTwoFactorCode(userId, oldCode)).toBe(true);
    expect(await verifyTwoFactorCode(userId, pendingCode)).toBe(false);

    const pendingRow = await pool.query<{
      legacySecret: string | null;
      pendingCiphertext: string;
      pendingIv: string;
      pendingAuthTag: string;
      pendingVersion: number;
    }>(
      `select legacy_secret as "legacySecret",
              pending_secret_ciphertext as "pendingCiphertext",
              pending_secret_iv as "pendingIv",
              pending_secret_auth_tag as "pendingAuthTag",
              pending_secret_version as "pendingVersion"
       from user_2fa_methods
       where user_id = $1`,
      [userId]
    );
    expect(pendingRow.rows[0].legacySecret).toBeNull();
    expect(pendingRow.rows[0].pendingCiphertext).not.toContain(replacement.secret);
    expect(
      decryptTwoFactorSecret(
        {
          ciphertext: pendingRow.rows[0].pendingCiphertext,
          iv: pendingRow.rows[0].pendingIv,
          authTag: pendingRow.rows[0].pendingAuthTag,
          version: pendingRow.rows[0].pendingVersion
        },
        userId
      )
    ).toBe(replacement.secret);

    const replacementBackupCodes = await confirmTwoFactor(userId, pendingCode);
    expect(replacementBackupCodes).toHaveLength(10);
    expect(await verifyTwoFactorCode(userId, generateTotpCode(replacement.secret))).toBe(true);
    expect(await verifyTwoFactorCode(userId, oldCode)).toBe(false);
    expect(await verifyTwoFactorCode(userId, initial.backupCodes[0])).toBe(false);

    const activeRow = await pool.query<{
      pendingCiphertext: string | null;
      activeCiphertext: string | null;
    }>(
      `select pending_secret_ciphertext as "pendingCiphertext",
              active_secret_ciphertext as "activeCiphertext"
       from user_2fa_methods
       where user_id = $1`,
      [userId]
    );
    expect(activeRow.rows[0].pendingCiphertext).toBeNull();
    expect(activeRow.rows[0].activeCiphertext).toBeTruthy();
  });

  it("expires a pending replacement without disturbing the active method", async () => {
    const userId = await createPasswordUser();
    const initial = await enableTwoFactor(userId);
    const replacement = await setupTwoFactor(
      userId,
      `${userId}@test.local`,
      { currentPassword: PASSWORD }
    );
    await pool.query(
      `update user_2fa_methods
       set pending_created_at = now() - interval '21 minutes'
       where user_id = $1`,
      [userId]
    );

    await expect(
      confirmTwoFactor(userId, generateTotpCode(replacement.secret))
    ).rejects.toThrow(/expired/i);
    expect(await verifyTwoFactorCode(userId, generateTotpCode(initial.secret))).toBe(true);

    const pending = await pool.query<{ count: string }>(
      `select count(*)::text as count
       from user_2fa_methods
       where user_id = $1 and pending_secret_ciphertext is not null`,
      [userId]
    );
    expect(pending.rows[0].count).toBe("0");
  });

  it("consumes one backup code successfully in only one concurrent request", async () => {
    const userId = await createPasswordUser();
    const enabled = await enableTwoFactor(userId);
    const [first, second] = await Promise.all([
      verifyTwoFactorCode(userId, enabled.backupCodes[0]),
      verifyTwoFactorCode(userId, enabled.backupCodes[0])
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
    const used = await pool.query<{ count: string }>(
      `select count(*)::text as count
       from user_2fa_backup_codes
       where user_id = $1 and used_at is not null`,
      [userId]
    );
    expect(used.rows[0].count).toBe("1");
  });

  it("requires reauthentication when rotating backup codes", async () => {
    const userId = await createPasswordUser();
    const enabled = await enableTwoFactor(userId);

    await expect(
      regenerateTwoFactorBackupCodes(userId, {})
    ).rejects.toThrow(/confirm this action/i);
    const nextCodes = await regenerateTwoFactorBackupCodes(
      userId,
      { currentPassword: PASSWORD }
    );

    expect(nextCodes).toHaveLength(10);
    expect(await verifyTwoFactorCode(userId, enabled.backupCodes[0])).toBe(false);
    expect(await verifyTwoFactorCode(userId, nextCodes[0])).toBe(true);
  });

  it("lets a Telegram-only account disable 2FA with its active TOTP", async () => {
    const userId = await createUser();
    await pool.query(`update users set telegram_id = $2 where id = $1`, [
      userId,
      `telegram-${userId}`
    ]);
    const enabled = await enableTwoFactor(userId);
    const session = await issueSession(userId, "user");
    const response = await request(app)
      .post("/users/me/2fa/disable")
      .set("Cookie", [
        `access_token=${session.accessToken}`,
        `csrf_token=${session.csrfToken}`
      ])
      .set("X-CSRF-Token", session.csrfToken)
      .send({ totpCode: generateTotpCode(enabled.secret) });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });

    const state = await pool.query<{
      enabled: boolean;
      methods: string;
      codes: string;
      audits: string;
    }>(
      `select u.two_factor_enabled as enabled,
              (select count(*) from user_2fa_methods where user_id = u.id)::text as methods,
              (select count(*) from user_2fa_backup_codes where user_id = u.id)::text as codes,
              (select count(*) from audit_logs where user_id = u.id and action = 'two_factor_disabled')::text as audits
       from users u
       where u.id = $1`,
      [userId]
    );
    expect(state.rows[0]).toEqual({
      enabled: false,
      methods: "0",
      codes: "0",
      audits: "1"
    });
  });

  it("rolls the complete disable operation back when the security audit write fails", async () => {
    const userId = await createPasswordUser();
    await enableTwoFactor(userId);
    await pool.query(`
      create function test_fail_two_factor_disable_audit()
      returns trigger as $$
      begin
        if new.action = 'two_factor_disabled' then
          raise exception 'forced two-factor audit failure';
        end if;
        return new;
      end;
      $$ language plpgsql
    `);
    await pool.query(`
      create trigger test_fail_two_factor_disable_audit
      before insert on audit_logs
      for each row execute function test_fail_two_factor_disable_audit()
    `);

    try {
      await expect(
        disableTwoFactor(userId, { currentPassword: PASSWORD })
      ).rejects.toThrow(/forced two-factor audit failure/i);

      const state = await pool.query<{
        enabled: boolean;
        methods: string;
        codes: string;
      }>(
        `select u.two_factor_enabled as enabled,
                (select count(*) from user_2fa_methods where user_id = u.id)::text as methods,
                (select count(*) from user_2fa_backup_codes where user_id = u.id)::text as codes
         from users u
         where u.id = $1`,
        [userId]
      );
      expect(state.rows[0]).toEqual({
        enabled: true,
        methods: "1",
        codes: "10"
      });
    } finally {
      await pool.query(`drop trigger if exists test_fail_two_factor_disable_audit on audit_logs`);
      await pool.query(`drop function if exists test_fail_two_factor_disable_audit()`);
    }
  });

  it("encrypts and clears a confirmed legacy plaintext secret during backfill", async () => {
    const userId = await createUser();
    const legacySecret = generateTotpSecret();
    await pool.query(`update users set two_factor_enabled = true where id = $1`, [userId]);
    await pool.query(
      `insert into user_2fa_methods(user_id, legacy_secret, confirmed_at)
       values ($1, $2, now())`,
      [userId, legacySecret]
    );

    expect(await migrateLegacyTwoFactorSecrets(userId)).toBe(1);
    const method = await pool.query<{
      legacySecret: string | null;
      ciphertext: string;
      iv: string;
      authTag: string;
      version: number;
    }>(
      `select legacy_secret as "legacySecret",
              active_secret_ciphertext as ciphertext,
              active_secret_iv as iv,
              active_secret_auth_tag as "authTag",
              active_secret_version as version
       from user_2fa_methods
       where user_id = $1`,
      [userId]
    );
    expect(method.rows[0].legacySecret).toBeNull();
    expect(method.rows[0].ciphertext).not.toContain(legacySecret);
    expect(
      decryptTwoFactorSecret(
        {
          ciphertext: method.rows[0].ciphertext,
          iv: method.rows[0].iv,
          authTag: method.rows[0].authTag,
          version: method.rows[0].version
        },
        userId
      )
    ).toBe(legacySecret);
    expect(await verifyTwoFactorCode(userId, generateTotpCode(legacySecret))).toBe(true);
  });
});
