import bcrypt from "bcryptjs";
import { z } from "zod";

export const PASSWORD_MIN_CODE_POINTS = 12;
export const PASSWORD_MAX_UTF8_BYTES = 72;
export const PASSWORD_INPUT_MAX_CODE_UNITS = 256;
export const PASSWORD_BCRYPT_ROUNDS = 12;

// This is a verifier for a deliberately nonexistent account, not a credential. Keeping
// it at the production bcrypt cost makes unknown, passwordless and wrong-password login
// paths perform the same class of expensive work without generating a hash per request.
export const DUMMY_PASSWORD_HASH =
  "$2a$12$UUggZaCPu3aaEvAqpV1tjON9nXMGW7Fm2khqieMlSUYvKlECswEx2";

export function normalizePassword(password: string) {
  return password.normalize("NFC");
}

function codePointLength(value: string) {
  return Array.from(value).length;
}

export const newPasswordSchema = z
  .string()
  .max(PASSWORD_INPUT_MAX_CODE_UNITS, "Password is too long")
  .transform(normalizePassword)
  .superRefine((password, ctx) => {
    if (codePointLength(password) < PASSWORD_MIN_CODE_POINTS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Password must contain at least ${PASSWORD_MIN_CODE_POINTS} characters`
      });
    }
    if (Buffer.byteLength(password, "utf8") > PASSWORD_MAX_UTF8_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Password must not exceed ${PASSWORD_MAX_UTF8_BYTES} UTF-8 bytes`
      });
    }
  });

// Login and current-password inputs must continue to accept legacy credentials. The
// bound prevents oversized request bodies without applying the new-password policy.
export const existingPasswordSchema = z
  .string()
  .min(1)
  .max(PASSWORD_INPUT_MAX_CODE_UNITS);

export async function hashPassword(password: string) {
  return bcrypt.hash(normalizePassword(password), PASSWORD_BCRYPT_ROUNDS);
}

/**
 * New passwords are stored in NFC. For a legacy non-NFC password, try the canonical
 * representation first and the historical raw bytes second. Unknown/passwordless
 * accounts use the same helper with the fixed dummy hash, so both variants perform the
 * same number and cost of bcrypt comparisons as a real account.
 */
export async function verifyPassword(password: string, passwordHash: string | null | undefined) {
  const verifier = passwordHash ?? DUMMY_PASSWORD_HASH;
  const normalized = normalizePassword(password);
  const normalizedMatch = await bcrypt.compare(normalized, verifier);
  if (normalized === password) return normalizedMatch;

  const legacyRawMatch = await bcrypt.compare(password, verifier);
  return normalizedMatch || legacyRawMatch;
}
