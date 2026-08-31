import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const MAX_ENCODED_CIPHERTEXT_LENGTH = 8_192;

export type TwoFactorEncryptionKey = {
  keyHex: string;
  version: number;
};

export type TwoFactorEncryptionConfig = TwoFactorEncryptionKey & {
  previousKeys?: readonly TwoFactorEncryptionKey[];
};

export type EncryptedTwoFactorSecret = {
  ciphertext: string;
  iv: string;
  authTag: string;
  version: number;
};

export type DecryptedTwoFactorSecret = {
  secret: string;
  needsRotation: boolean;
};

function assertKeyVersion(version: number): void {
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new Error("TWO_FACTOR_ENCRYPTION_KEY_VERSION must be a positive integer");
  }
}

function encryptionKey(entry: TwoFactorEncryptionKey): Buffer {
  assertKeyVersion(entry.version);
  if (!/^[a-fA-F0-9]{64}$/.test(entry.keyHex)) {
    throw new Error("TWO_FACTOR_ENCRYPTION_KEY must be 64 hexadecimal characters");
  }
  const key = Buffer.from(entry.keyHex, "hex");
  if (key.length !== 32) {
    throw new Error("TWO_FACTOR_ENCRYPTION_KEY must decode to exactly 32 bytes");
  }
  return key;
}

function encryptionKeyring(config: TwoFactorEncryptionConfig): Map<number, Buffer> {
  if (config.previousKeys !== undefined && !Array.isArray(config.previousKeys)) {
    throw new Error("TWO_FACTOR_ENCRYPTION_PREVIOUS_KEYS must be an array");
  }

  const entries: readonly TwoFactorEncryptionKey[] = [
    { keyHex: config.keyHex, version: config.version },
    ...(config.previousKeys ?? [])
  ];
  const keyring = new Map<number, Buffer>();
  for (const entry of entries) {
    if (keyring.has(entry.version)) {
      throw new Error(`Duplicate two-factor encryption key version: ${entry.version}`);
    }
    keyring.set(entry.version, encryptionKey(entry));
  }
  return keyring;
}

function additionalAuthenticatedData(userId: string, version: number): Buffer {
  if (typeof userId !== "string" || userId.length === 0) {
    throw new Error("Two-factor secret user id must not be empty");
  }
  return Buffer.from(`skrynia:2fa:${userId}:v${version}`, "utf8");
}

function decodeBase64Strict(
  value: string,
  field: string,
  options: { exactBytes?: number; maxEncodedLength?: number } = {}
): Buffer {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    (options.maxEncodedLength !== undefined && value.length > options.maxEncodedLength) ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    throw new Error(`Malformed two-factor ${field}`);
  }

  const decoded = Buffer.from(value, "base64");
  if (
    decoded.toString("base64") !== value ||
    (options.exactBytes !== undefined && decoded.length !== options.exactBytes)
  ) {
    throw new Error(`Malformed two-factor ${field}`);
  }
  return decoded;
}

export function encryptTwoFactorSecretWithConfig(
  secret: string,
  userId: string,
  config: TwoFactorEncryptionConfig
): EncryptedTwoFactorSecret {
  const keyring = encryptionKeyring(config);
  const currentKey = keyring.get(config.version);
  if (!currentKey) {
    throw new Error("Current two-factor encryption key is unavailable");
  }

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, currentKey, iv, {
    authTagLength: AUTH_TAG_BYTES
  });
  cipher.setAAD(additionalAuthenticatedData(userId, config.version));
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    version: config.version
  };
}

export function decryptTwoFactorSecretWithConfigForRotation(
  encrypted: EncryptedTwoFactorSecret,
  userId: string,
  config: TwoFactorEncryptionConfig
): DecryptedTwoFactorSecret {
  assertKeyVersion(encrypted.version);
  const keyring = encryptionKeyring(config);
  const key = keyring.get(encrypted.version);
  if (!key) {
    throw new Error(`Unsupported two-factor encryption key version: ${encrypted.version}`);
  }

  const iv = decodeBase64Strict(encrypted.iv, "IV", { exactBytes: IV_BYTES });
  const authTag = decodeBase64Strict(encrypted.authTag, "authentication tag", {
    exactBytes: AUTH_TAG_BYTES
  });
  const ciphertext = decodeBase64Strict(encrypted.ciphertext, "ciphertext", {
    maxEncodedLength: MAX_ENCODED_CIPHERTEXT_LENGTH
  });

  const decipher = createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_BYTES
  });
  decipher.setAAD(additionalAuthenticatedData(userId, encrypted.version));
  decipher.setAuthTag(authTag);
  const secret = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");

  return {
    secret,
    needsRotation: encrypted.version !== config.version
  };
}

export function decryptTwoFactorSecretWithConfig(
  encrypted: EncryptedTwoFactorSecret,
  userId: string,
  config: TwoFactorEncryptionConfig
): string {
  return decryptTwoFactorSecretWithConfigForRotation(encrypted, userId, config).secret;
}
