import {
  encryptTwoFactorSecretWithConfig,
  type TwoFactorEncryptionConfig
} from "../modules/auth/twofa-crypto-core.js";

type LegacyMethodRow = {
  id: string;
  userId: string;
  legacySecret: string;
  confirmedAt: Date | null;
  createdAt: Date;
};

export type LegacyTwoFactorMigrationClient = {
  query(
    text: string,
    values?: unknown[]
  ): Promise<{ rows?: unknown[]; rowCount?: number | null }>;
};

/**
 * Encrypts pre-keyring 2FA secrets using only the release-job DB session and
 * TWO_FACTOR_* inputs. Importing this module must never validate unrelated HTTP,
 * payment, Redis, mail, or metrics configuration.
 */
export async function migrateLegacyTwoFactorSecretsForRelease(
  client: LegacyTwoFactorMigrationClient,
  encryption: TwoFactorEncryptionConfig
): Promise<number> {
  let migrated = 0;

  while (true) {
    await client.query("begin");
    try {
      const result = await client.query(
        `select id, user_id as "userId", legacy_secret as "legacySecret",
                confirmed_at as "confirmedAt", created_at as "createdAt"
         from user_2fa_methods
         where legacy_secret is not null
         order by created_at, id
         limit 100
         for update`,
        []
      );
      const rows = (result.rows ?? []) as LegacyMethodRow[];

      for (const row of rows) {
        const encrypted = encryptTwoFactorSecretWithConfig(
          row.legacySecret,
          row.userId,
          encryption
        );
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
            [
              row.id,
              encrypted.ciphertext,
              encrypted.iv,
              encrypted.authTag,
              encrypted.version
            ]
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

      await client.query("commit");
      migrated += rows.length;
      if (rows.length < 100) return migrated;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    }
  }
}
