/**
 * Defense-in-depth redaction for anything persisted to audit_logs. Keys are matched
 * case-insensitively and also as substrings for the high-risk families (token/secret/
 * password), so `newPassword`, `refreshToken`, `csrfToken`, `TOTPSecret` etc. are all
 * caught without having to enumerate every spelling.
 */

const EXACT_SENSITIVE_KEYS = new Set(
  [
    "password",
    "currentPassword",
    "newPassword",
    "repeatPassword",
    "token",
    "accessToken",
    "refreshToken",
    "csrfToken",
    "secret",
    "ticket",
    "code",
    "otp",
    "totp",
    "backupCode",
    "backupCodes",
    "deliveryNote",
    "deliveryTemplate",
    "accountNumber",
    "iban",
    "cardNumber",
    "destination",
    "privateKey",
    "apiKey",
    "authorization",
    "cookie",
    "body",
    "message",
    "note"
  ].map((key) => key.toLowerCase())
);

const SENSITIVE_KEY_FRAGMENTS = ["password", "token", "secret", "ticket", "code", "otp", "iban", "card"];

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (EXACT_SENSITIVE_KEYS.has(lower)) return true;
  return SENSITIVE_KEY_FRAGMENTS.some((fragment) => lower.includes(fragment));
}

export function redactSensitive(value: unknown, depth = 0): unknown {
  if (!value || typeof value !== "object") return value;
  if (depth > 8) return "[truncated]";
  if (Array.isArray(value)) return value.map((item) => redactSensitive(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      isSensitiveKey(key) ? "[redacted]" : redactSensitive(item, depth + 1)
    ])
  );
}
