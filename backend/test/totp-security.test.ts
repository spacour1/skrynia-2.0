import { describe, expect, it } from "vitest";
import {
  APP_TOTP_PARAMETERS,
  TOTP_PERIOD_SECONDS,
  buildOtpauthUri,
  generateRfc6238Code,
  generateTotpCode,
  generateTotpSecret,
  matchTotpCounter,
  verifyTotpCode
} from "../src/modules/auth/totp.service.js";
import {
  decryptTwoFactorSecretWithConfig,
  decryptTwoFactorSecretWithConfigForRotation,
  encryptTwoFactorSecretWithConfig,
  type EncryptedTwoFactorSecret,
  type TwoFactorEncryptionConfig
} from "../src/modules/auth/twofa-crypto-core.js";

const RFC_6238_SHA1_TEST_VECTOR = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const RFC_6238_SHA1_PARAMETERS = {
  algorithm: "sha1",
  periodSeconds: 30,
  digits: 8
} as const;

describe("RFC 6238 TOTP policy", () => {
  it.each([
    [59, "94287082"],
    [1_111_111_109, "07081804"],
    [1_111_111_111, "14050471"],
    [1_234_567_890, "89005924"],
    [2_000_000_000, "69279037"],
    [20_000_000_000, "65353130"]
  ])("matches the official RFC 6238 SHA1 vector at %i seconds", (seconds, expected) => {
    expect(
      generateRfc6238Code(
        RFC_6238_SHA1_TEST_VECTOR,
        seconds * 1_000,
        RFC_6238_SHA1_PARAMETERS
      )
    ).toBe(expected);
  });

  it("uses an explicit six-digit SHA1/30-second application policy", () => {
    expect(APP_TOTP_PARAMETERS).toEqual({
      algorithm: "sha1",
      periodSeconds: 30,
      digits: 6
    });

    const atTimeMs = 1_700_000_000_000;
    expect(generateTotpCode(RFC_6238_SHA1_TEST_VECTOR, atTimeMs)).toMatch(/^\d{6}$/);
  });

  it("returns the matched safe-integer counter within only one drift step", () => {
    const atTimeMs = 1_700_000_000_000;
    const currentCounter = Math.floor(atTimeMs / 1_000 / TOTP_PERIOD_SECONDS);
    const currentCode = generateTotpCode(RFC_6238_SHA1_TEST_VECTOR, atTimeMs);
    const previousCode = generateTotpCode(
      RFC_6238_SHA1_TEST_VECTOR,
      atTimeMs - TOTP_PERIOD_SECONDS * 1_000
    );
    const nextCode = generateTotpCode(
      RFC_6238_SHA1_TEST_VECTOR,
      atTimeMs + TOTP_PERIOD_SECONDS * 1_000
    );
    const tooOldCode = generateTotpCode(
      RFC_6238_SHA1_TEST_VECTOR,
      atTimeMs - TOTP_PERIOD_SECONDS * 2_000
    );

    expect(matchTotpCounter(RFC_6238_SHA1_TEST_VECTOR, currentCode, atTimeMs)).toBe(
      currentCounter
    );
    expect(matchTotpCounter(RFC_6238_SHA1_TEST_VECTOR, previousCode, atTimeMs)).toBe(
      currentCounter - 1
    );
    expect(matchTotpCounter(RFC_6238_SHA1_TEST_VECTOR, nextCode, atTimeMs)).toBe(
      currentCounter + 1
    );
    expect(matchTotpCounter(RFC_6238_SHA1_TEST_VECTOR, tooOldCode, atTimeMs)).toBeNull();
  });

  it("accepts only an exact six-digit application code", () => {
    const atTimeMs = 1_700_000_000_000;
    const code = generateTotpCode(RFC_6238_SHA1_TEST_VECTOR, atTimeMs);

    expect(verifyTotpCode(RFC_6238_SHA1_TEST_VECTOR, code, atTimeMs)).toBe(true);
    expect(verifyTotpCode(RFC_6238_SHA1_TEST_VECTOR, ` ${code}`, atTimeMs)).toBe(false);
    expect(verifyTotpCode(RFC_6238_SHA1_TEST_VECTOR, `${code} `, atTimeMs)).toBe(false);
    expect(verifyTotpCode(RFC_6238_SHA1_TEST_VECTOR, code.slice(1), atTimeMs)).toBe(false);
    expect(verifyTotpCode(RFC_6238_SHA1_TEST_VECTOR, `${code}0`, atTimeMs)).toBe(false);
  });

  it.each([
    "gez dgnbvgy3tqojq",
    "GEZD-GNBVGY3TQOJQ",
    "GEZD0NBVGY3TQOJQ",
    "gezdgnbvgy3tqojq",
    "MZ",
    "MY=====",
    "MY======="
  ])("rejects non-canonical Base32 without stripping it: %s", (secret) => {
    expect(() => generateTotpCode(secret, 0)).toThrow(/Base32/i);
    expect(matchTotpCounter(secret, "000000", 0)).toBeNull();
    expect(() => buildOtpauthUri(secret, "account", "SKRYNIA")).toThrow(/Base32/i);
  });

  it("accepts canonical padded and unpadded RFC 4648 encodings", () => {
    expect(generateTotpCode("MY======", 0)).toBe(generateTotpCode("MY", 0));
  });

  it("generates canonical unpadded 160-bit Base32 secrets", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(() => buildOtpauthUri(secret, "account", "SKRYNIA")).not.toThrow();
  });
});

const OLD_KEY = "11".repeat(32);
const CURRENT_KEY = "22".repeat(32);
const USER_ID = "a8ef557d-83f7-4bbf-837d-f6ba410ffc95";
const SECRET = "JBSWY3DPEHPK3PXP";

const oldConfig: TwoFactorEncryptionConfig = {
  keyHex: OLD_KEY,
  version: 1
};
const rotatingConfig: TwoFactorEncryptionConfig = {
  keyHex: CURRENT_KEY,
  version: 2,
  previousKeys: [{ keyHex: OLD_KEY, version: 1 }]
};
const preloadedConfig: TwoFactorEncryptionConfig = {
  keyHex: OLD_KEY,
  version: 1,
  previousKeys: [{ keyHex: CURRENT_KEY, version: 2 }]
};

describe("two-factor encryption key rotation", () => {
  it("encrypts with only the current version", () => {
    const encrypted = encryptTwoFactorSecretWithConfig(SECRET, USER_ID, rotatingConfig);

    expect(encrypted.version).toBe(2);
    expect(
      decryptTwoFactorSecretWithConfigForRotation(encrypted, USER_ID, rotatingConfig)
    ).toEqual({ secret: SECRET, needsRotation: false });
  });

  it("decrypts an explicitly configured previous version and marks it for rotation", () => {
    const encrypted = encryptTwoFactorSecretWithConfig(SECRET, USER_ID, oldConfig);

    expect(
      decryptTwoFactorSecretWithConfigForRotation(encrypted, USER_ID, rotatingConfig)
    ).toEqual({ secret: SECRET, needsRotation: true });
    expect(decryptTwoFactorSecretWithConfig(encrypted, USER_ID, rotatingConfig)).toBe(SECRET);
  });

  it("keeps both key versions readable across a two-phase rolling rotation", () => {
    const versionOneEnvelope = encryptTwoFactorSecretWithConfig(SECRET, USER_ID, oldConfig);
    const versionTwoEnvelope = encryptTwoFactorSecretWithConfig(SECRET, USER_ID, rotatingConfig);

    expect(decryptTwoFactorSecretWithConfig(versionOneEnvelope, USER_ID, preloadedConfig)).toBe(
      SECRET
    );
    expect(decryptTwoFactorSecretWithConfig(versionTwoEnvelope, USER_ID, preloadedConfig)).toBe(
      SECRET
    );
    expect(decryptTwoFactorSecretWithConfig(versionOneEnvelope, USER_ID, rotatingConfig)).toBe(
      SECRET
    );
    expect(decryptTwoFactorSecretWithConfig(versionTwoEnvelope, USER_ID, rotatingConfig)).toBe(
      SECRET
    );
  });

  it("rejects unknown and duplicate key versions", () => {
    const encrypted = encryptTwoFactorSecretWithConfig(SECRET, USER_ID, oldConfig);

    expect(() =>
      decryptTwoFactorSecretWithConfig(encrypted, USER_ID, {
        keyHex: CURRENT_KEY,
        version: 2
      })
    ).toThrow(/Unsupported.*version/i);

    expect(() =>
      encryptTwoFactorSecretWithConfig(SECRET, USER_ID, {
        keyHex: CURRENT_KEY,
        version: 2,
        previousKeys: [{ keyHex: OLD_KEY, version: 2 }]
      })
    ).toThrow(/Duplicate.*version/i);

    expect(() =>
      encryptTwoFactorSecretWithConfig(SECRET, USER_ID, {
        keyHex: CURRENT_KEY,
        version: 3,
        previousKeys: [
          { keyHex: OLD_KEY, version: 1 },
          { keyHex: OLD_KEY, version: 1 }
        ]
      })
    ).toThrow(/Duplicate.*version/i);
  });

  it.each([
    ["iv", "not-base64"],
    ["iv", Buffer.alloc(11).toString("base64")],
    ["authTag", "AA"],
    ["authTag", Buffer.alloc(15).toString("base64")],
    ["ciphertext", ""],
    ["ciphertext", "%%%="]
  ] as const)("rejects malformed %s values", (field, value) => {
    const encrypted = encryptTwoFactorSecretWithConfig(SECRET, USER_ID, oldConfig);
    const malformed: EncryptedTwoFactorSecret = { ...encrypted, [field]: value };

    expect(() =>
      decryptTwoFactorSecretWithConfig(malformed, USER_ID, oldConfig)
    ).toThrow();
  });

  it("fails authentication for tampering or a different user binding", () => {
    const encrypted = encryptTwoFactorSecretWithConfig(SECRET, USER_ID, oldConfig);
    const ciphertext = Buffer.from(encrypted.ciphertext, "base64");
    ciphertext[0] ^= 1;
    const tampered = { ...encrypted, ciphertext: ciphertext.toString("base64") };

    expect(() => decryptTwoFactorSecretWithConfig(tampered, USER_ID, oldConfig)).toThrow();
    expect(() =>
      decryptTwoFactorSecretWithConfig(encrypted, "different-user", oldConfig)
    ).toThrow();
  });
});
