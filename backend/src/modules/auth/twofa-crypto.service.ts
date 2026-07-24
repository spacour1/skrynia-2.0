import { env } from "../../config/env.js";
import {
  decryptTwoFactorSecretWithConfig,
  encryptTwoFactorSecretWithConfig,
  type EncryptedTwoFactorSecret
} from "./twofa-crypto-core.js";

export type { EncryptedTwoFactorSecret } from "./twofa-crypto-core.js";

function encryptionConfig() {
  return {
    keyHex: env.TWO_FACTOR_ENCRYPTION_KEY,
    version: env.TWO_FACTOR_ENCRYPTION_KEY_VERSION
  };
}

export function encryptTwoFactorSecret(secret: string, userId: string): EncryptedTwoFactorSecret {
  return encryptTwoFactorSecretWithConfig(
    secret,
    userId,
    encryptionConfig()
  );
}

export function decryptTwoFactorSecret(
  encrypted: EncryptedTwoFactorSecret,
  userId: string
): string {
  return decryptTwoFactorSecretWithConfig(
    encrypted,
    userId,
    encryptionConfig()
  );
}
