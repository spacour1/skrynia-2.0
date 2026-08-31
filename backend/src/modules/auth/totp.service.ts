import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const MAX_BASE32_SECRET_LENGTH = 4_096;

export const TOTP_ALGORITHM = "sha1" as const;
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
export const TOTP_ALLOWED_DRIFT_STEPS = 1;

export type Rfc6238Parameters = Readonly<{
  algorithm: typeof TOTP_ALGORITHM;
  periodSeconds: number;
  digits: number;
}>;

export const APP_TOTP_PARAMETERS: Rfc6238Parameters = Object.freeze({
  algorithm: TOTP_ALGORITHM,
  periodSeconds: TOTP_PERIOD_SECONDS,
  digits: TOTP_DIGITS
});

function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32DecodeStrict(input: string): Buffer {
  if (
    input.length === 0 ||
    input.length > MAX_BASE32_SECRET_LENGTH ||
    !/^[A-Z2-7]+={0,6}$/.test(input)
  ) {
    throw new Error("TOTP secret must be canonical RFC 4648 Base32");
  }

  const paddingIndex = input.indexOf("=");
  const unpadded = paddingIndex === -1 ? input : input.slice(0, paddingIndex);
  if (paddingIndex !== -1 && input.length % 8 !== 0) {
    throw new Error("TOTP secret must have valid RFC 4648 Base32 padding");
  }

  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of unpadded) {
    const index = BASE32_ALPHABET.indexOf(char);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  const decoded = Buffer.from(bytes);
  const canonicalUnpadded = base32Encode(decoded);
  if (canonicalUnpadded !== unpadded) {
    throw new Error("TOTP secret must be canonical RFC 4648 Base32");
  }

  if (paddingIndex !== -1) {
    const expectedPadding = (8 - (canonicalUnpadded.length % 8)) % 8;
    if (`${canonicalUnpadded}${"=".repeat(expectedPadding)}` !== input) {
      throw new Error("TOTP secret must have valid RFC 4648 Base32 padding");
    }
  }

  return decoded;
}

function assertRfc6238Parameters(parameters: Rfc6238Parameters): void {
  if (parameters.algorithm !== TOTP_ALGORITHM) {
    throw new Error("Unsupported TOTP algorithm");
  }
  if (!Number.isSafeInteger(parameters.periodSeconds) || parameters.periodSeconds < 1) {
    throw new Error("TOTP period must be a positive safe integer");
  }
  if (!Number.isSafeInteger(parameters.digits) || parameters.digits < 6 || parameters.digits > 8) {
    throw new Error("TOTP digits must be an integer between 6 and 8");
  }
}

function counterAt(atTimeMs: number, periodSeconds: number): number {
  if (!Number.isFinite(atTimeMs) || atTimeMs < 0) {
    throw new Error("TOTP time must be a non-negative finite number");
  }
  const counter = Math.floor(atTimeMs / 1_000 / periodSeconds);
  if (!Number.isSafeInteger(counter)) {
    throw new Error("TOTP counter exceeds the safe integer range");
  }
  return counter;
}

function hotpAt(key: Buffer, counter: number, parameters: Rfc6238Parameters): string {
  if (!Number.isSafeInteger(counter) || counter < 0) {
    throw new Error("TOTP counter must be a non-negative safe integer");
  }

  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const hmac = createHmac(parameters.algorithm, key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binCode % 10 ** parameters.digits).padStart(parameters.digits, "0");
}

/** A fresh random 160-bit TOTP secret encoded as unpadded RFC 4648 Base32. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function buildOtpauthUri(secret: string, accountLabel: string, issuer: string): string {
  base32DecodeStrict(secret);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS)
  });
  const label = encodeURIComponent(`${issuer}:${accountLabel}`);
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Low-level RFC 6238 generator, exported so the official 8-digit vectors can be verified. */
export function generateRfc6238Code(
  secret: string,
  atTimeMs: number,
  parameters: Rfc6238Parameters
): string {
  assertRfc6238Parameters(parameters);
  const key = base32DecodeStrict(secret);
  return hotpAt(key, counterAt(atTimeMs, parameters.periodSeconds), parameters);
}

/** App policy: RFC 6238, HMAC-SHA1, six digits, and a 30-second period. */
export function generateTotpCode(secret: string, atTimeMs: number = Date.now()): string {
  return generateRfc6238Code(secret, atTimeMs, APP_TOTP_PARAMETERS);
}

/**
 * Returns the exact RFC 6238 counter accepted by the app policy, or null.
 * All candidate windows are compared in constant time and drift is bounded to one step.
 */
export function matchTotpCounter(
  secret: string,
  code: string,
  atTimeMs: number = Date.now()
): number | null {
  if (!/^\d{6}$/.test(code)) return null;

  let key: Buffer;
  let currentCounter: number;
  try {
    key = base32DecodeStrict(secret);
    currentCounter = counterAt(atTimeMs, TOTP_PERIOD_SECONDS);
  } catch {
    return null;
  }

  const submitted = Buffer.from(code, "ascii");
  let matchedCounter: number | null = null;
  for (const offset of [0, -TOTP_ALLOWED_DRIFT_STEPS, TOTP_ALLOWED_DRIFT_STEPS]) {
    const candidateCounter = currentCounter + offset;
    if (candidateCounter < 0) continue;
    const expected = Buffer.from(
      hotpAt(key, candidateCounter, APP_TOTP_PARAMETERS),
      "ascii"
    );
    if (timingSafeEqual(expected, submitted) && matchedCounter === null) {
      matchedCounter = candidateCounter;
    }
  }
  return matchedCounter;
}

export function verifyTotpCode(secret: string, code: string, atTimeMs: number = Date.now()): boolean {
  return matchTotpCounter(secret, code, atTimeMs) !== null;
}
