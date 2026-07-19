import { randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { inTx, pool, type DbClient } from "../../db/pool.js";
import { badRequest } from "../../common/errors.js";
import { buildOtpauthUri, generateTotpSecret, verifyTotpCode } from "./totp.service.js";
import { createNotification } from "../notifications/notifications.service.js";
import {
  decryptTwoFactorSecret,
  encryptTwoFactorSecret,
  type EncryptedTwoFactorSecret
} from "./twofa-crypto.service.js";

const BACKUP_CODE_COUNT = 10;
const PENDING_SECRET_TTL_MS = 20 * 60 * 1000;

type TwoFactorMethodRow = {
  legacySecret: string | null;
  confirmedAt: Date | null;
  createdAt: Date;
  activeSecretCiphertext: string | null;
  activeSecretIv: string | null;
  activeSecretAuthTag: string | null;
  activeSecretVersion: number | null;
  pendingSecretCiphertext: string | null;
  pendingSecretIv: string | null;
  pendingSecretAuthTag: string | null;
  pendingSecretVersion: number | null;
  pendingCreatedAt: Date | null;
};

type UserSecurityRow = {
  passwordHash: string | null;
  twoFactorEnabled: boolean;
};

type LegacyMethodRow = {
  id: string;
  userId: string;
  legacySecret: string;
  confirmedAt: Date | null;
  createdAt: Date;
};

export type TwoFactorReauthentication = {
  currentPassword?: string;
  totpCode?: string;
};

export type TwoFactorAuditContext = {
  traceId?: string;
  method?: string;
  path?: string;
  endpoint?: string;
};

function generateBackupCode(): string {
  // 4+4 hex chars, formatted like XXXX-XXXX - easy to read off a printed/saved list, plenty
  // of entropy for something that's also rate-limited and single-use.
  const raw = randomBytes(4).toString("hex").toUpperCase();
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
}

function activeSecretFromRow(row: TwoFactorMethodRow | undefined): EncryptedTwoFactorSecret | null {
  if (
    !row?.activeSecretCiphertext ||
    !row.activeSecretIv ||
    !row.activeSecretAuthTag ||
    row.activeSecretVersion === null
  ) {
    return null;
  }
  return {
    ciphertext: row.activeSecretCiphertext,
    iv: row.activeSecretIv,
    authTag: row.activeSecretAuthTag,
    version: row.activeSecretVersion
  };
}

function pendingSecretFromRow(row: TwoFactorMethodRow | undefined): EncryptedTwoFactorSecret | null {
  if (
    !row?.pendingSecretCiphertext ||
    !row.pendingSecretIv ||
    !row.pendingSecretAuthTag ||
    row.pendingSecretVersion === null
  ) {
    return null;
  }
  return {
    ciphertext: row.pendingSecretCiphertext,
    iv: row.pendingSecretIv,
    authTag: row.pendingSecretAuthTag,
    version: row.pendingSecretVersion
  };
}

async function selectMethod(client: DbClient, userId: string, forUpdate = false) {
  return client.query<TwoFactorMethodRow>(
    `select legacy_secret as "legacySecret",
            confirmed_at as "confirmedAt",
            created_at as "createdAt",
            active_secret_ciphertext as "activeSecretCiphertext",
            active_secret_iv as "activeSecretIv",
            active_secret_auth_tag as "activeSecretAuthTag",
            active_secret_version as "activeSecretVersion",
            pending_secret_ciphertext as "pendingSecretCiphertext",
            pending_secret_iv as "pendingSecretIv",
            pending_secret_auth_tag as "pendingSecretAuthTag",
            pending_secret_version as "pendingSecretVersion",
            pending_created_at as "pendingCreatedAt"
     from user_2fa_methods
     where user_id = $1
     ${forUpdate ? "for update" : ""}`,
    [userId]
  );
}

async function migrateLegacyBatch(userId?: string): Promise<number> {
  return inTx(async (client) => {
    const result = await client.query<LegacyMethodRow>(
      `select id, user_id as "userId", legacy_secret as "legacySecret",
              confirmed_at as "confirmedAt", created_at as "createdAt"
       from user_2fa_methods
       where legacy_secret is not null
         ${userId ? "and user_id = $1" : ""}
       order by created_at, id
       limit 100
       for update`,
      userId ? [userId] : []
    );

    for (const row of result.rows) {
      const encrypted = encryptTwoFactorSecret(row.legacySecret, row.userId);
      if (row.confirmedAt) {
        await client.query(
          `update user_2fa_methods
           set legacy_secret = null,
               active_secret_ciphertext = $2,
               active_secret_iv = $3,
               active_secret_auth_tag = $4,
               active_secret_version = $5,
               updated_at = now()
           where id = $1`,
          [row.id, encrypted.ciphertext, encrypted.iv, encrypted.authTag, encrypted.version]
        );
      } else {
        await client.query(
          `update user_2fa_methods
           set legacy_secret = null,
               pending_secret_ciphertext = $2,
               pending_secret_iv = $3,
               pending_secret_auth_tag = $4,
               pending_secret_version = $5,
               pending_created_at = $6,
               updated_at = now()
           where id = $1`,
          [
            row.id,
            encrypted.ciphertext,
            encrypted.iv,
            encrypted.authTag,
            encrypted.version,
            row.createdAt
          ]
        );
      }
    }

    return result.rowCount ?? 0;
  });
}

/**
 * Encrypts secrets left by the previous schema. The SQL migration cannot perform this
 * step because the AES key belongs to the application, not PostgreSQL.
 */
export async function migrateLegacyTwoFactorSecrets(userId?: string): Promise<number> {
  let migrated = 0;
  do {
    const batchSize = await migrateLegacyBatch(userId);
    migrated += batchSize;
    if (userId || batchSize < 100) break;
  } while (true);
  return migrated;
}

async function selectUserForSecurityAction(client: DbClient, userId: string) {
  const result = await client.query<UserSecurityRow>(
    `select password_hash as "passwordHash",
            two_factor_enabled as "twoFactorEnabled"
     from users
     where id = $1
     for update`,
    [userId]
  );
  const user = result.rows[0];
  if (!user) throw badRequest("Account not found");
  return user;
}

async function activeTotpMatches(client: DbClient, userId: string, code: string): Promise<boolean> {
  const method = await selectMethod(client, userId);
  const encrypted = activeSecretFromRow(method.rows[0]);
  if (!encrypted) return false;
  return verifyTotpCode(decryptTwoFactorSecret(encrypted, userId), code);
}

async function requireReauthentication(
  client: DbClient,
  userId: string,
  user: UserSecurityRow,
  input: TwoFactorReauthentication
) {
  if (!input.currentPassword && !input.totpCode) {
    throw badRequest("Confirm this action with your current password or authenticator code");
  }

  if (
    input.currentPassword &&
    user.passwordHash &&
    (await bcrypt.compare(input.currentPassword, user.passwordHash))
  ) {
    return;
  }

  if (input.totpCode && user.twoFactorEnabled && (await activeTotpMatches(client, userId, input.totpCode))) {
    return;
  }

  throw badRequest("Current password or authenticator code is incorrect");
}

async function recordSecurityAudit(
  client: DbClient,
  userId: string,
  action: string,
  context: TwoFactorAuditContext = {}
) {
  const path = context.path ?? `/internal/security/${action}`;
  await client.query(
    `insert into audit_logs(
       trace_id, user_id, method, path, endpoint, status_code, action, request_body, metadata
     )
     values ($1, $2, $3, $4, $5, 200, $6, null, $7::jsonb)`,
    [
      context.traceId ?? randomUUID(),
      userId,
      context.method ?? "SYSTEM",
      path,
      context.endpoint ?? path,
      action,
      JSON.stringify({ securityEvent: true })
    ]
  );
}

async function createBackupCodes(client: DbClient, userId: string): Promise<string[]> {
  const backupCodes = Array.from({ length: BACKUP_CODE_COUNT }, generateBackupCode);
  const hashedCodes = await Promise.all(backupCodes.map((value) => bcrypt.hash(value, 10)));
  await client.query(`delete from user_2fa_backup_codes where user_id = $1`, [userId]);
  await client.query(
    `insert into user_2fa_backup_codes(user_id, code_hash)
     select $1, code_hash
     from unnest($2::text[]) as code_hash`,
    [userId, hashedCodes]
  );
  return backupCodes;
}

/**
 * Starts setup without touching the active secret. Replacing an enabled method requires
 * the current password or a code from that still-active method.
 */
export async function setupTwoFactor(
  userId: string,
  accountLabel: string,
  reauthentication: TwoFactorReauthentication = {}
) {
  await migrateLegacyTwoFactorSecrets(userId);
  const secret = generateTotpSecret();
  const encrypted = encryptTwoFactorSecret(secret, userId);

  await inTx(async (client) => {
    const user = await selectUserForSecurityAction(client, userId);
    if (user.twoFactorEnabled) {
      await requireReauthentication(client, userId, user, reauthentication);
    }

    await client.query(
      `insert into user_2fa_methods(
         user_id,
         pending_secret_ciphertext,
         pending_secret_iv,
         pending_secret_auth_tag,
         pending_secret_version,
         pending_created_at
       )
       values ($1, $2, $3, $4, $5, now())
       on conflict (user_id) do update
       set pending_secret_ciphertext = excluded.pending_secret_ciphertext,
           pending_secret_iv = excluded.pending_secret_iv,
           pending_secret_auth_tag = excluded.pending_secret_auth_tag,
           pending_secret_version = excluded.pending_secret_version,
           pending_created_at = excluded.pending_created_at,
           updated_at = now()`,
      [userId, encrypted.ciphertext, encrypted.iv, encrypted.authTag, encrypted.version]
    );
  });

  return { secret, otpauthUri: buildOtpauthUri(secret, accountLabel, "SKRYNIA") };
}

/** Confirms setup with one real code from the app, flips the account over to 2FA-required, and issues backup codes (shown to the user exactly once). */
export async function confirmTwoFactor(
  userId: string,
  code: string,
  auditContext: TwoFactorAuditContext = {}
): Promise<string[]> {
  await migrateLegacyTwoFactorSecrets(userId);

  const result = await inTx(async (client) => {
    await selectUserForSecurityAction(client, userId);
    const methodResult = await selectMethod(client, userId, true);
    const method = methodResult.rows[0];
    const encrypted = pendingSecretFromRow(method);
    if (!encrypted || !method?.pendingCreatedAt) throw badRequest("Start 2FA setup first");

    if (Date.now() - new Date(method.pendingCreatedAt).getTime() > PENDING_SECRET_TTL_MS) {
      await client.query(
        `update user_2fa_methods
         set pending_secret_ciphertext = null,
             pending_secret_iv = null,
             pending_secret_auth_tag = null,
             pending_secret_version = null,
             pending_created_at = null,
             updated_at = now()
         where user_id = $1`,
        [userId]
      );
      return { expired: true as const };
    }

    const secret = decryptTwoFactorSecret(encrypted, userId);
    if (!verifyTotpCode(secret, code)) throw badRequest("Invalid code");

    const backupCodes = await createBackupCodes(client, userId);
    await client.query(
      `update user_2fa_methods
       set legacy_secret = null,
           active_secret_ciphertext = pending_secret_ciphertext,
           active_secret_iv = pending_secret_iv,
           active_secret_auth_tag = pending_secret_auth_tag,
           active_secret_version = pending_secret_version,
           pending_secret_ciphertext = null,
           pending_secret_iv = null,
           pending_secret_auth_tag = null,
           pending_secret_version = null,
           pending_created_at = null,
           confirmed_at = now(),
           updated_at = now()
       where user_id = $1`,
      [userId]
    );
    await client.query(
      `update users
       set two_factor_enabled = true, updated_at = now()
       where id = $1`,
      [userId]
    );
    await recordSecurityAudit(client, userId, "two_factor_enabled", auditContext);
    return { expired: false as const, backupCodes };
  });

  if (result.expired) throw badRequest("Two-factor setup expired; start setup again");

  await createNotification({
    userId,
    type: "two_factor_enabled",
    templateKey: "notifications.twoFactorEnabled"
  });
  return result.backupCodes;
}

export async function regenerateTwoFactorBackupCodes(
  userId: string,
  reauthentication: TwoFactorReauthentication,
  auditContext: TwoFactorAuditContext = {}
): Promise<string[]> {
  await migrateLegacyTwoFactorSecrets(userId);
  return inTx(async (client) => {
    const user = await selectUserForSecurityAction(client, userId);
    if (!user.twoFactorEnabled) throw badRequest("Two-factor authentication is not enabled");
    await requireReauthentication(client, userId, user, reauthentication);

    const method = await selectMethod(client, userId, true);
    if (!activeSecretFromRow(method.rows[0])) {
      throw badRequest("Two-factor authentication is not configured");
    }

    const backupCodes = await createBackupCodes(client, userId);
    await recordSecurityAudit(
      client,
      userId,
      "two_factor_backup_codes_regenerated",
      auditContext
    );
    return backupCodes;
  });
}

export async function disableTwoFactor(
  userId: string,
  reauthentication: TwoFactorReauthentication,
  auditContext: TwoFactorAuditContext = {}
) {
  await migrateLegacyTwoFactorSecrets(userId);
  await inTx(async (client) => {
    const user = await selectUserForSecurityAction(client, userId);
    if (!user.twoFactorEnabled) throw badRequest("Two-factor authentication is not enabled");
    await requireReauthentication(client, userId, user, reauthentication);

    await client.query(`delete from user_2fa_backup_codes where user_id = $1`, [userId]);
    await client.query(`delete from user_2fa_methods where user_id = $1`, [userId]);
    await client.query(
      `update users
       set two_factor_enabled = false, updated_at = now()
       where id = $1`,
      [userId]
    );
    await recordSecurityAudit(client, userId, "two_factor_disabled", auditContext);
  });

  await createNotification({
    userId,
    type: "two_factor_disabled",
    templateKey: "notifications.twoFactorDisabled"
  });
}

/** Used at login: a confirmed TOTP code, or a single-use backup code (consumed on success). */
export async function verifyTwoFactorCode(userId: string, code: string): Promise<boolean> {
  await migrateLegacyTwoFactorSecrets(userId);
  const method = await selectMethod(pool, userId);
  const encrypted = activeSecretFromRow(method.rows[0]);
  if (!encrypted) return false;
  const secret = decryptTwoFactorSecret(encrypted, userId);
  if (verifyTotpCode(secret, code)) return true;

  const trimmedCode = code.trim().toUpperCase();
  if (!trimmedCode) return false;
  const backupCodes = await pool.query<{ id: string; codeHash: string }>(
    `select id, code_hash as "codeHash" from user_2fa_backup_codes where user_id = $1 and used_at is null`,
    [userId]
  );
  for (const row of backupCodes.rows) {
    if (await bcrypt.compare(trimmedCode, row.codeHash)) {
      const consumed = await pool.query(
        `update user_2fa_backup_codes
         set used_at = now()
         where id = $1 and user_id = $2 and used_at is null
         returning id`,
        [row.id, userId]
      );
      return consumed.rowCount === 1;
    }
  }
  return false;
}
