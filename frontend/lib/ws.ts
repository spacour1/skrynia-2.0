import { ApiError, apiFetch, WS_URL } from "./api";

export class WebSocketTicketError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;

  constructor(input: {
    message: string;
    status: number;
    code: string;
    retryable: boolean;
    retryAfterMs?: number;
    cause?: unknown;
  }) {
    super(input.message, { cause: input.cause });
    this.name = "WebSocketTicketError";
    this.status = input.status;
    this.code = input.code;
    this.retryable = input.retryable;
    this.retryAfterMs = input.retryAfterMs;
  }
}

function normalizeTicketError(error: unknown): WebSocketTicketError {
  if (error instanceof WebSocketTicketError) return error;
  if (error instanceof ApiError) {
    return new WebSocketTicketError({
      message: error.message,
      status: error.status,
      code: error.code ?? `ticket_http_${error.status}`,
      retryable: error.status === 429 || error.status >= 500,
      retryAfterMs:
        error.status === 429 && error.retryAfterSeconds !== undefined
          ? error.retryAfterSeconds * 1000
          : undefined,
      cause: error
    });
  }
  return new WebSocketTicketError({
    message: error instanceof Error ? error.message : "Could not request a WebSocket ticket",
    status: 0,
    code: "ticket_network_error",
    retryable: true,
    cause: error
  });
}

function cookieFallbackAllowed() {
  if (process.env.NODE_ENV !== "production") return true;
  if (process.env.NEXT_PUBLIC_WS_COOKIE_FALLBACK === "true") return true;
  if (typeof window === "undefined") return false;

  try {
    const target = new URL(WS_URL, window.location.href);
    const expectedProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return target.protocol === expectedProtocol && target.host === window.location.host;
  } catch {
    return false;
  }
}

function openSocket(url: string) {
  try {
    return new WebSocket(url);
  } catch (error) {
    throw new WebSocketTicketError({
      message: error instanceof Error ? error.message : "Could not open the WebSocket",
      status: 0,
      code: "websocket_open_error",
      retryable: true,
      cause: error
    });
  }
}

/**
 * Requests a new one-time ticket for every connection attempt. Cookie authentication is
 * only a compatibility fallback for transient ticket-service failures in deployments
 * where the browser can actually send the cookie to the WebSocket endpoint.
 */
export async function openAuthedSocket(): Promise<WebSocket> {
  try {
    const { ticket } = await apiFetch<{ ticket: string }>("/auth/ws-ticket", { method: "POST" });
    const separator = WS_URL.includes("?") ? "&" : "?";
    return openSocket(`${WS_URL}${separator}ticket=${encodeURIComponent(ticket)}`);
  } catch (error) {
    const ticketError = normalizeTicketError(error);
    if (
      cookieFallbackAllowed() &&
      ticketError.retryable &&
      ticketError.status !== 429
    ) {
      return openSocket(WS_URL);
    }
    throw ticketError;
  }
}
