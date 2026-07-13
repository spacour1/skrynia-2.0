import crypto from "node:crypto";
import { getRedis } from "../../common/redis.js";
import { ApiError } from "../../common/errors.js";

/**
 * One-time WebSocket connection tickets. REST auth rides on same-origin httpOnly cookies,
 * but the WS endpoint can live on a different domain where those cookies never arrive.
 * A ticket is a short-lived, single-use, cryptographically random handle to an existing
 * authenticated session:
 *  - not a JWT (nothing to decode offline, nothing bearer-reusable);
 *  - stored in Redis under the SHA-256 of the ticket (a Redis dump never yields usable
 *    tickets), with a ~25s TTL;
 *  - consumed atomically with GETDEL, so a replayed ticket always fails.
 */

const TICKET_TTL_SECONDS = 25;

export type WsTicketIdentity = {
  userId: string;
  jti: string;
  emailVerified: boolean;
  createdAt: string;
};

function ticketKey(ticket: string) {
  return `ws-ticket:${crypto.createHash("sha256").update(ticket).digest("hex")}`;
}

export async function issueWsTicket(identity: Omit<WsTicketIdentity, "createdAt">): Promise<{ ticket: string; expiresInSeconds: number }> {
  const redis = getRedis();
  if (!redis) throw new ApiError(503, "Realtime is temporarily unavailable", "realtime_unavailable");

  const ticket = crypto.randomBytes(32).toString("base64url");
  const value: WsTicketIdentity = { ...identity, createdAt: new Date().toISOString() };
  await redis.set(ticketKey(ticket), JSON.stringify(value), "EX", TICKET_TTL_SECONDS);
  return { ticket, expiresInSeconds: TICKET_TTL_SECONDS };
}

/** Atomically consumes a ticket; returns null for unknown, expired or already-used tickets. */
export async function consumeWsTicket(ticket: string): Promise<WsTicketIdentity | null> {
  const redis = getRedis();
  if (!redis || !ticket || ticket.length > 128) return null;
  const raw = await redis.getdel(ticketKey(ticket));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as WsTicketIdentity;
  } catch {
    return null;
  }
}
