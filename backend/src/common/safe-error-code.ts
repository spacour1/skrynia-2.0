const SAFE_ERROR_CODES = new Set([
  "ABORT_ERR",
  "ASK",
  "BUSY",
  "CLUSTERDOWN",
  "ECONNREFUSED",
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
  "MOVED",
  "NOAUTH",
  "NOSCRIPT",
  "READONLY",
  "WRONGTYPE"
]);

/**
 * Reduces operational failures to an allowlisted classification. Never serialize the
 * original error here: Redis ReplyError objects can expose command arguments such as
 * session and refresh-family keys through enumerable metadata.
 */
export function safeErrorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    const code = String(error.code).toUpperCase();
    if (SAFE_ERROR_CODES.has(code)) return code.toLowerCase();
  }
  if (error instanceof Error) {
    if (error.name === "AbortError") return "abort_error";
    if (error.name === "ReplyError") return "redis_reply_error";
  }
  return "unknown_error";
}
