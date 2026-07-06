import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { inTx, pool } from "../../db/pool.js";
import { badRequest } from "../../common/errors.js";
import { buildOtpauthUri, generateTotpSecret, verifyTotpCode } from "./totp.service.js";
import { createNotification } from "../notifications/notifications.service.js";

const BACKUP_CODE_COUNT = 10;

function generateBackupCode(): string {
  // 4+4 hex chars, formatted like XXXX-XXXX - easy to read off a printed/saved list, plenty
  // of entropy for something that's also rate-limited and single-use.
  const raw = randomBytes(4).toString("hex").toUpperCase();
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
}

/** Starts setup: generates a new (unconfirmed) secret and returns the otpauth URI to scan. Calling this again before confirming just replaces the pending secret. */
export async function setupTwoFactor(userId: string, accountLabel: string) {
  const secret = generateTotpSecret();
  await pool.query(
    `insert into user_2fa_methods(user_id, secret, confirmed_at)
     values ($1, $2, null)
     on conflict (user_id) do update set secret = excluded.secret, confirmed_at = null`,
    [userId, secret]
  );
  return { secret, otpauthUri: buildOtpauthUri(secret, accountLabel, "SKRYNIA") };
}

/** Confirms setup with one real code from the app, flips the account over to 2FA-required, and issues backup codes (shown to the user exactly once). */
export async function confirmTwoFactor(userId: string, code: string): Promise<string[]> {
  const method = await pool.query<{ secret: string }>(
    `select secret from user_2fa_methods where user_id = $1 and confirmed_at is null`,
    [userId]
  );
  const secret = method.rows[0]?.secret;
  if (!secret) throw badRequest("Start 2FA setup first");
  if (!verifyTotpCode(secret, code)) throw badRequest("Invalid code");

  const backupCodes = Array.from({ length: BACKUP_CODE_COUNT }, generateBackupCode);
  const hashedCodes = await Promise.all(backupCodes.map((value) => bcrypt.hash(value, 10)));

  await inTx(async (client) => {
    await client.query(`update user_2fa_methods set confirmed_at = now() where user_id = $1`, [userId]);
    await client.query(`delete from user_2fa_backup_codes where user_id = $1`, [userId]);
    for (const hash of hashedCodes) {
      await client.query(`insert into user_2fa_backup_codes(user_id, code_hash) values ($1, $2)`, [userId, hash]);
    }
    await client.query(`update users set two_factor_enabled = true, updated_at = now() where id = $1`, [userId]);
  });

  await createNotification({
    userId,
    type: "two_factor_enabled",
    templateKey: "notifications.twoFactorEnabled"
  });
  return backupCodes;
}

export async function disableTwoFactor(userId: string) {
  await pool.query(`delete from user_2fa_methods where user_id = $1`, [userId]);
  await pool.query(`delete from user_2fa_backup_codes where user_id = $1`, [userId]);
  await pool.query(`update users set two_factor_enabled = false, updated_at = now() where id = $1`, [userId]);
  await createNotification({
    userId,
    type: "two_factor_disabled",
    templateKey: "notifications.twoFactorDisabled"
  });
}

/** Used at login: a confirmed TOTP code, or a single-use backup code (consumed on success). */
export async function verifyTwoFactorCode(userId: string, code: string): Promise<boolean> {
  const method = await pool.query<{ secret: string }>(
    `select secret from user_2fa_methods where user_id = $1 and confirmed_at is not null`,
    [userId]
  );
  const secret = method.rows[0]?.secret;
  if (secret && verifyTotpCode(secret, code)) return true;

  const trimmedCode = code.trim().toUpperCase();
  if (!trimmedCode) return false;
  const backupCodes = await pool.query<{ id: string; codeHash: string }>(
    `select id, code_hash as "codeHash" from user_2fa_backup_codes where user_id = $1 and used_at is null`,
    [userId]
  );
  for (const row of backupCodes.rows) {
    if (await bcrypt.compare(trimmedCode, row.codeHash)) {
      await pool.query(`update user_2fa_backup_codes set used_at = now() where id = $1`, [row.id]);
      return true;
    }
  }
  return false;
}
