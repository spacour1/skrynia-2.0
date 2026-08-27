const URL_FIELDS = new Set(["url", "uri", "path", "from", "to"]);
const SAFE_REQUEST_HEADERS = new Set(["content-type", "x-request-id", "x-trace-id"]);
const URL_IN_TEXT = /\b(?:https?|wss?):\/\/[^\s<>"']+/gi;
const EMAIL_IN_TEXT = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_IN_TEXT = /\+(?:\d[\s().-]?){7,14}\d/g;
const IBAN_IN_TEXT = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/gi;
const LONG_DIGIT_SEQUENCE = /\b\d(?:[ -]?\d){12,18}\b/g;
const BEARER_IN_TEXT = /\bBearer\s+[A-Z0-9._~+/=-]+/gi;
const JWT_IN_TEXT = /\beyJ[A-Z0-9_-]+\.[A-Z0-9_-]+\.[A-Z0-9_-]+\b/gi;
const SECRET_ASSIGNMENT_IN_TEXT =
  /(\b(?:authorization|[a-z0-9_-]*(?:password|secret|token|cookie|ticket|api[_-]?key|access[_-]?key|private[_-]?key|credential|jwt|session)|(?:otp|totp|verification|reset|recovery)[a-z0-9_-]*code)\b\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;
const SENSITIVE_PATH_SEGMENT =
  /(\/(?:reset(?:-password)?|verify(?:-email)?|verification|invite|token|ticket|auth|callback|users?|sellers?|profiles?|sessions?))(?:\/[^/?#\s]+)+/gi;
const USERINFO_IN_URL = /((?:https?|wss?):\/\/)[^/@\s]+@/gi;
const UUID_PATH_SEGMENT =
  /\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?=\/|$)/gi;
const OPAQUE_PATH_SEGMENT = /\/[A-Z0-9_-]{20,}(?=\/|$)/gi;

type SentryBreadcrumbLike = {
  data?: Record<string, unknown>;
};

type SentryEventLike = {
  request?: {
    url?: string;
    method?: string;
    query_string?: unknown;
    data?: unknown;
    cookies?: unknown;
    headers?: Record<string, unknown>;
  };
  breadcrumbs?: SentryBreadcrumbLike[];
  contexts?: Record<string, unknown>;
  extra?: Record<string, unknown>;
  transaction?: string;
  user?: Record<string, unknown>;
};

function stripUrlDetails(value: string) {
  const queryIndex = value.indexOf("?");
  const fragmentIndex = value.indexOf("#");
  const indexes = [queryIndex, fragmentIndex].filter((index) => index >= 0);
  const withoutQueryOrFragment =
    indexes.length > 0 ? value.slice(0, Math.min(...indexes)) : value;
  return withoutQueryOrFragment
    .replace(USERINFO_IN_URL, "$1[redacted]@")
    .replace(SENSITIVE_PATH_SEGMENT, "$1/[redacted]")
    .replace(UUID_PATH_SEGMENT, "/[redacted-id]")
    .replace(OPAQUE_PATH_SEGMENT, "/[redacted]");
}

function sanitizeString(value: string) {
  return value
    .replace(URL_IN_TEXT, (url) => stripUrlDetails(url))
    .replace(BEARER_IN_TEXT, "Bearer [redacted]")
    .replace(JWT_IN_TEXT, "[redacted-jwt]")
    .replace(SECRET_ASSIGNMENT_IN_TEXT, "$1[redacted]")
    .replace(EMAIL_IN_TEXT, "[redacted-email]")
    .replace(PHONE_IN_TEXT, "[redacted-phone]")
    .replace(IBAN_IN_TEXT, "[redacted-iban]")
    .replace(LONG_DIGIT_SEQUENCE, "[redacted-number]");
}

function isSensitiveKey(key: string) {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return (
    normalized === "authorization" ||
    normalized === "email" ||
    normalized === "phone" ||
    normalized === "iban" ||
    normalized.includes("apikey") ||
    normalized.includes("accesskey") ||
    normalized.includes("privatekey") ||
    normalized.includes("credential") ||
    normalized.includes("jwt") ||
    normalized.includes("session") ||
    normalized.endsWith("ticket") ||
    normalized === "cardnumber" ||
    normalized.includes("password") ||
    normalized.includes("secret") ||
    normalized.includes("token") ||
    normalized.includes("cookie") ||
    /(?:backup|recovery|reset|verification|totp|otp)code(?:s)?$/.test(normalized)
  );
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return sanitizeString(value);
  if (!value || typeof value !== "object") return value;
  if (depth > 8) return "[truncated]";
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, depth + 1));

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => {
      if (isSensitiveKey(key)) return [key, "[redacted]"];
      if (URL_FIELDS.has(key.toLowerCase()) && typeof item === "string") {
        return [key, sanitizeString(stripUrlDetails(item))];
      }
      return [key, sanitizeValue(item, depth + 1)];
    })
  );
}

export function sanitizeSentryBreadcrumb<T extends SentryBreadcrumbLike>(breadcrumb: T): T {
  return sanitizeValue(breadcrumb) as T;
}

export function sanitizeSentryEvent<T extends SentryEventLike>(event: T): T {
  const sanitizedEvent = sanitizeValue(event) as T;

  if (sanitizedEvent.request) {
    const request = sanitizedEvent.request;
    sanitizedEvent.request = {
      ...(typeof request.url === "string" ? { url: stripUrlDetails(request.url) } : {}),
      ...(typeof request.method === "string" ? { method: request.method } : {}),
      ...(request.headers
        ? {
            headers: Object.fromEntries(
              Object.entries(request.headers).filter(([key]) =>
                SAFE_REQUEST_HEADERS.has(key.toLowerCase())
              )
            ),
          }
        : {}),
    };
  }

  if (sanitizedEvent.transaction) {
    sanitizedEvent.transaction = stripUrlDetails(sanitizedEvent.transaction);
  }
  if (sanitizedEvent.user) {
    sanitizedEvent.user = Object.fromEntries(
      Object.entries(sanitizedEvent.user).filter(
        ([key, value]) => (key === "id" || key === "segment") && typeof value === "string"
      )
    );
  }
  return sanitizedEvent;
}
