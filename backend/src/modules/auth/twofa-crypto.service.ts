import { env } from "../../config/env.js";
import {
  decryptTwoFactorSecretWithConfigForRotation,
  decryptTwoFactorSecretWithConfig,
  encryptTwoFactorSecretWithConfig,
  type DecryptedTwoFactorSecret,
  type EncryptedTwoFactorSecret
} from "./twofa-crypto-core.js";

export type {
  DecryptedTwoFactorSecret,
  EncryptedTwoFactorSecret
} from "./twofa-crypto-core.js";

function encryptionConfig() {
  return {
    keyHex: env.TWO_FACTOR_ENCRYPTION_KEY,
    version: env.TWO_FACTOR_ENCRYPTION_KEY_VERSION,
    previousKeys: env.TWO_FACTOR_ENCRYPTION_PREVIOUS_KEYS
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
  return decryptTwoFactorSecretWithConfig(encrypted, userId, encryptionConfig());
}

export function decryptTwoFactorSecretForRotation(
  encrypted: EncryptedTwoFactorSecret,
  userId: string
): DecryptedTwoFactorSecret {
  return decryptTwoFactorSecretWithConfigForRotation(
    encrypted,
    userId,
    encryptionConfig()
  );
}
