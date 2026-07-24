import {
  createCipheriv,
  createDecipheriv,
  randomBytes
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

export type TwoFactorEncryptionConfig = {
  keyHex: string;
  version: number;
};

export type EncryptedTwoFactorSecret = {
  ciphertext: string;
  iv: string;
  authTag: string;
  version: number;
};

function encryptionKey(config: TwoFactorEncryptionConfig) {
  if (!/^[a-fA-F0-9]{64}$/.test(config.keyHex)) {
    throw new Error(
      "TWO_FACTOR_ENCRYPTION_KEY must be 64 hexadecimal characters"
    );
  }
  const key = Buffer.from(config.keyHex, "hex");
  if (key.length !== 32) {
    throw new Error("TWO_FACTOR_ENCRYPTION_KEY must decode to exactly 32 bytes");
  }
  return key;
}

function additionalAuthenticatedData(userId: string, version: number) {
  return Buffer.from(`skrynia:2fa:${userId}:v${version}`, "utf8");
}

export function encryptTwoFactorSecretWithConfig(
  secret: string,
  userId: string,
  config: TwoFactorEncryptionConfig
): EncryptedTwoFactorSecret {
  if (!Number.isSafeInteger(config.version) || config.version < 1) {
    throw new Error("TWO_FACTOR_ENCRYPTION_KEY_VERSION must be a positive integer");
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(config), iv, {
    authTagLength: AUTH_TAG_BYTES
  });
  cipher.setAAD(additionalAuthenticatedData(userId, config.version));
  const ciphertext = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final()
  ]);

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    version: config.version
  };
}

export function decryptTwoFactorSecretWithConfig(
  encrypted: EncryptedTwoFactorSecret,
  userId: string,
  config: TwoFactorEncryptionConfig
): string {
  if (encrypted.version !== config.version) {
    throw new Error(
      `Unsupported two-factor encryption key version: ${encrypted.version}`
    );
  }
  const decipher = createDecipheriv(
    ALGORITHM,
    encryptionKey(config),
    Buffer.from(encrypted.iv, "base64"),
    { authTagLength: AUTH_TAG_BYTES }
  );
  decipher.setAAD(additionalAuthenticatedData(userId, encrypted.version));
  decipher.setAuthTag(Buffer.from(encrypted.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
    decipher.final()
  ]).toString("utf8");
}
