import { fileURLToPath } from "node:url";
import pg from "pg";
import { runner } from "node-pg-migrate";
import {
  migrateLegacyTwoFactorSecretsForRelease,
  type LegacyTwoFactorMigrationClient
} from "./migrate-legacy-twofa.js";

/**
 * A repository-owned, stable lock ID. Do not change it between releases: every
 * release job must contend for the same PostgreSQL session lock.
 */
export const RELEASE_MIGRATION_LOCK_ID = "793278818471982910";

const DEFAULT_MIGRATIONS_DIR = fileURLToPath(new URL("../../migrations/", import.meta.url));

export interface ReleaseMigrationClient {
  connect(): Promise<unknown>;
  end(): Promise<void>;
  query(text: string, values?: unknown[]): Promise<unknown>;
}

export type ReleaseMigrationSummary = {
  sqlMigrations: number;
  legacyTwoFactorSecrets: number;
};

export type ReleaseMigrationOptions = {
  databaseUrl: string;
  migrationsDir?: string;
  twoFactorEncryptionKey?: string;
  twoFactorEncryptionKeyVersion?: number;
  createClient?: (databaseUrl: string) => ReleaseMigrationClient;
  runSqlMigrations?: (client: ReleaseMigrationClient, migrationsDir: string) => Promise<number>;
  migrateLegacySecrets?: (client: ReleaseMigrationClient) => Promise<number>;
};

function createPgClient(databaseUrl: string): ReleaseMigrationClient {
  return new pg.Client({ connectionString: databaseUrl }) as unknown as ReleaseMigrationClient;
}

async function runRepositorySqlMigrations(
  client: ReleaseMigrationClient,
  migrationsDir: string
): Promise<number> {
  const applied = await runner({
    dbClient: client as unknown as pg.Client,
    dir: migrationsDir,
    direction: "up",
    migrationsTable: "pgmigrations",
    checkOrder: true,
    singleTransaction: true,
    // The release wrapper owns one lock across both SQL and application data
    // migrations, so node-pg-migrate must not acquire a shorter-lived second lock.
    noLock: true
  });
  return applied.length;
}

/**
 * Applies repository SQL migrations and the key-backed legacy 2FA migration while
 * holding one PostgreSQL advisory lock. API/worker startup must never call this.
 */
export async function runReleaseMigrations(
  options: ReleaseMigrationOptions
): Promise<ReleaseMigrationSummary> {
  if (!options.databaseUrl.trim()) {
    throw new Error("DATABASE_URL is required for release migrations");
  }
  if (
    !options.migrateLegacySecrets &&
    !/^[a-fA-F0-9]{64}$/.test(options.twoFactorEncryptionKey ?? "")
  ) {
    throw new Error(
      "TWO_FACTOR_ENCRYPTION_KEY is required for release migrations"
    );
  }
  const encryptionKeyVersion = options.twoFactorEncryptionKeyVersion ?? 1;
  if (
    !options.migrateLegacySecrets &&
    (!Number.isSafeInteger(encryptionKeyVersion) || encryptionKeyVersion < 1)
  ) {
    throw new Error(
      "TWO_FACTOR_ENCRYPTION_KEY_VERSION must be a positive integer"
    );
  }

  const client = (options.createClient ?? createPgClient)(options.databaseUrl);
  const runSqlMigrations = options.runSqlMigrations ?? runRepositorySqlMigrations;
  const migrateLegacySecrets =
    options.migrateLegacySecrets ??
    ((migrationClient: ReleaseMigrationClient) =>
      migrateLegacyTwoFactorSecretsForRelease(
        migrationClient as unknown as LegacyTwoFactorMigrationClient,
        {
          keyHex: options.twoFactorEncryptionKey!,
          version: encryptionKeyVersion
        }
      ));
  const migrationsDir = options.migrationsDir ?? DEFAULT_MIGRATIONS_DIR;
  let lockAcquired = false;

  await client.connect();
  try {
    await client.query("select pg_advisory_lock($1::bigint)", [RELEASE_MIGRATION_LOCK_ID]);
    lockAcquired = true;

    const sqlMigrations = await runSqlMigrations(client, migrationsDir);
    const legacyTwoFactorSecrets = await migrateLegacySecrets(client);
    return { sqlMigrations, legacyTwoFactorSecrets };
  } finally {
    try {
      if (lockAcquired) {
        await client.query("select pg_advisory_unlock($1::bigint)", [
          RELEASE_MIGRATION_LOCK_ID
        ]);
      }
    } finally {
      await client.end();
    }
  }
}
