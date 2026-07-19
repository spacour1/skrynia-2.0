import {
  createCipheriv,
  createDecipheriv,
  randomBytes
} from "node:crypto";
import { env } from "../../config/env.js";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

export type EncryptedTwoFactorSecret = {
  ciphertext: string;
  iv: string;
  authTag: string;
  version: number;
};

function encryptionKey() {
  const key = Buffer.from(env.TWO_FACTOR_ENCRYPTION_KEY, "hex");
  if (key.length !== 32) {
    throw new Error("TWO_FACTOR_ENCRYPTION_KEY must decode to exactly 32 bytes");
  }
  return key;
}

function additionalAuthenticatedData(userId: string, version: number) {
  return Buffer.from(`skrynia:2fa:${userId}:v${version}`, "utf8");
}

export function encryptTwoFactorSecret(secret: string, userId: string): EncryptedTwoFactorSecret {
  const version = env.TWO_FACTOR_ENCRYPTION_KEY_VERSION;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv, {
    authTagLength: AUTH_TAG_BYTES
  });
  cipher.setAAD(additionalAuthenticatedData(userId, version));
  const ciphertext = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final()
  ]);

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    version
  };
}

export function decryptTwoFactorSecret(
  encrypted: EncryptedTwoFactorSecret,
  userId: string
): string {
  if (encrypted.version !== env.TWO_FACTOR_ENCRYPTION_KEY_VERSION) {
    throw new Error(`Unsupported two-factor encryption key version: ${encrypted.version}`);
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    encryptionKey(),
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
