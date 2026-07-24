import "dotenv/config";
import { runReleaseMigrations } from "./migrate-deploy.js";

const databaseUrl = process.env.DATABASE_URL ?? "";

try {
  const result = await runReleaseMigrations({
    databaseUrl,
    twoFactorEncryptionKey: process.env.TWO_FACTOR_ENCRYPTION_KEY,
    twoFactorEncryptionKeyVersion: Number(
      process.env.TWO_FACTOR_ENCRYPTION_KEY_VERSION ?? "1"
    )
  });
  console.info(
    `Release migrations complete: ${result.sqlMigrations} SQL, ${result.legacyTwoFactorSecrets} legacy 2FA secrets`
  );
} catch {
  // Keep the error fixed and credential-free: driver errors may include connection
  // details and release logs are commonly retained by deployment platforms.
  console.error("Release migrations failed");
  process.exitCode = 1;
}
