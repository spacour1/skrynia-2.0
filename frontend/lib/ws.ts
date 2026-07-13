import { apiFetch, WS_URL } from "./api";

/**
 * Opens an authenticated WebSocket. The backend may live on a different domain than the
 * frontend, where the httpOnly auth cookie never accompanies the WS handshake - so we
 * first fetch a one-time, short-lived connection ticket over the same-origin REST API
 * (cookie + CSRF protected) and pass it as a query parameter. The ticket is single-use
 * and expires in seconds: it is never stored, logged, or reused across reconnects - every
 * call to this function obtains a fresh one. If the ticket endpoint is unavailable the
 * socket still tries the cookie-authenticated handshake, which keeps single-domain
 * deployments (e.g. local docker) working.
 */
export async function openAuthedSocket(): Promise<WebSocket> {
  let url = WS_URL;
  try {
    const { ticket } = await apiFetch<{ ticket: string }>("/auth/ws-ticket", { method: "POST" });
    url = `${WS_URL}${WS_URL.includes("?") ? "&" : "?"}ticket=${encodeURIComponent(ticket)}`;
  } catch {
    // fall back to the same-origin cookie handshake
  }
  return new WebSocket(url);
}
