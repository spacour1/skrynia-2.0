import type http from "node:http";
import jwt from "jsonwebtoken";
import { WebSocketServer, WebSocket } from "ws";
import { z } from "zod";
import { env } from "../../config/env.js";
import { pool } from "../../db/pool.js";
import { getRedis } from "../../common/redis.js";
import { logger } from "../../common/logger.js";
import { ACCESS_COOKIE } from "../../common/cookies.js";
import { ApiError } from "../../common/errors.js";
import {
  wsConnectionsActive,
  wsConnectionFailuresTotal,
  wsMessagesTotal,
  wsSlowClientsTotal
} from "../../common/metrics.js";
import { consumeWsTicket } from "../auth/ws-ticket.service.js";
import { onSessionSecurityEvent } from "../auth/session-events.service.js";
import { sendMessage } from "./chat.service.js";

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

type Client = WebSocket & {
  userId?: string;
  jti?: string;
  emailVerified?: boolean;
  rooms?: Set<string>;
  sentAt?: number[];
  isAlive?: boolean;
};

type JwtPayload = {
  sub: string;
  jti: string;
};

const clientsByUser = new Map<string, Set<Client>>();
const clientsByConversation = new Map<string, Set<Client>>();
// One jti can have several live connections (one per browser tab sharing the same cookies),
// so this must track a set, not a single client - see disconnectSession/leaveAll below.
const clientsByJti = new Map<string, Set<Client>>();

async function verifyUserAlive(userId: string) {
  const result = await pool.query<{ id: string; isBanned: boolean; emailVerified: boolean }>(
    `select id, is_banned as "isBanned",
            (email_verified_at is not null or telegram_id is not null) as "emailVerified"
     from users where id = $1`,
    [userId]
  );
  const user = result.rows[0];
  if (!user) throw new Error("Invalid user");
  if (user.isBanned) throw new Error("Account is banned");
  return user;
}

async function authenticateSocket(token: string) {
  const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
  if (!payload.jti) throw new Error("Missing session id");

  const redis = getRedis();
  if (redis) {
    try {
      const exists = await redis.exists(`session:${payload.jti}`);
      if (!exists) throw new Error("Session expired");
    } catch (error) {
      if (error instanceof Error && error.message === "Session expired") throw error;
      // Redis being briefly unreachable shouldn't refuse every WS connection in the
      // building - fall back to trusting the JWT's own signature/expiry, same as the
      // HTTP authenticate() middleware.
      logger.warn({ error, jti: payload.jti }, "ws_session_revocation_check_failed_redis_unavailable");
    }
  }

  const user = await verifyUserAlive(payload.sub);
  return { userId: user.id, jti: payload.jti, emailVerified: user.emailVerified };
}

/**
 * Ticket-first handshake auth: `?ticket=` (one-time, Redis-backed - works when the WS
 * endpoint lives on a different domain than the frontend, where the httpOnly auth cookie
 * never arrives) with the same-origin cookie as fallback for single-domain deployments.
 * The ticket's session is re-checked against Redis revocation and the user row, so a
 * banned user or revoked session can't ride in on a ticket issued moments earlier.
 */
async function authenticateHandshake(req: http.IncomingMessage) {
  const url = new URL(req.url ?? "/ws", "http://localhost");
  const ticket = url.searchParams.get("ticket");

  if (ticket) {
    const identity = await consumeWsTicket(ticket);
    if (!identity) throw new Error("Invalid ticket");
    const redis = getRedis();
    if (redis) {
      try {
        const exists = await redis.exists(`session:${identity.jti}`);
        if (!exists) throw new Error("Session expired");
      } catch (error) {
        if (error instanceof Error && error.message === "Session expired") throw error;
        logger.warn({ error, jti: identity.jti }, "ws_session_revocation_check_failed_redis_unavailable");
      }
    }
    const user = await verifyUserAlive(identity.userId);
    return { userId: identity.userId, jti: identity.jti, emailVerified: user.emailVerified };
  }

  const token = readCookie(req.headers.cookie, ACCESS_COOKIE);
  if (!token) throw new Error("Missing token");
  return authenticateSocket(token);
}

function allowedOrigins(): Set<string> {
  const origins = new Set<string>([env.FRONTEND_URL]);
  for (const origin of (env.ADDITIONAL_ALLOWED_ORIGINS ?? "").split(",")) {
    const trimmed = origin.trim();
    if (trimmed) origins.add(trimmed);
  }
  return origins;
}

/**
 * Browsers always send Origin on WebSocket handshakes - an unknown Origin means a foreign
 * site is trying to open a socket with the visitor's cookies. Requests without an Origin
 * header (non-browser clients, tests, health probes) are allowed: they carry no ambient
 * browser credentials to hijack.
 */
function isOriginAllowed(req: http.IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  return allowedOrigins().has(origin);
}

const MAX_CONNECTIONS_PER_USER = 12;

export const WS_CLOSE_SESSION_REVOKED = 4001;
export const WS_CLOSE_USER_BANNED = 4003;
export const WS_CLOSE_SLOW_CLIENT = 4008;

export function sendJson(client: WebSocket, payload: unknown) {
  if (client.readyState !== WebSocket.OPEN) return false;
  if (client.bufferedAmount > env.WS_MAX_BUFFERED_BYTES) {
    wsSlowClientsTotal.inc();
    try {
      client.close(WS_CLOSE_SLOW_CLIENT, "Slow client");
    } catch (error) {
      logger.warn({ error }, "ws_slow_client_close_failed");
    }
    return false;
  }

  try {
    client.send(JSON.stringify(payload));
    return true;
  } catch (error) {
    logger.warn({ error }, "ws_send_failed");
    try {
      client.close(1011, "Send failed");
    } catch {
      // The transport is already unusable; the close listener will clean maps if possible.
    }
    return false;
  }
}

async function canAccessConversation(conversationId: string, userId: string) {
  const result = await pool.query(
    `select 1 from conversations where id = $1 and (buyer_id = $2 or seller_id = $2)`,
    [conversationId, userId]
  );
  return Boolean(result.rows[0]);
}

function joinConversation(client: Client, conversationId: string) {
  client.rooms ??= new Set();
  client.rooms.add(conversationId);
  const room = clientsByConversation.get(conversationId) ?? new Set<Client>();
  room.add(client);
  clientsByConversation.set(conversationId, room);
}

function leaveConversation(client: Client, conversationId: string) {
  client.rooms?.delete(conversationId);
  const room = clientsByConversation.get(conversationId);
  if (!room) return;
  room.delete(client);
  if (room.size === 0) clientsByConversation.delete(conversationId);
}

function leaveAll(client: Client) {
  if (client.userId) {
    const clients = clientsByUser.get(client.userId);
    if (clients) {
      clients.delete(client);
      if (clients.size === 0) clientsByUser.delete(client.userId);
    }
  }
  if (client.jti) {
    const sameSession = clientsByJti.get(client.jti);
    if (sameSession) {
      sameSession.delete(client);
      if (sameSession.size === 0) clientsByJti.delete(client.jti);
    }
  }
  for (const room of Array.from(client.rooms ?? [])) leaveConversation(client, room);
}

export function disconnectSession(jti: string) {
  const clients = clientsByJti.get(jti);
  if (!clients) return;
  for (const client of Array.from(clients)) {
    if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
      client.close(WS_CLOSE_SESSION_REVOKED, "Session revoked");
    }
  }
}

export function disconnectUser(userId: string, exceptSessionId?: string) {
  const clients = clientsByUser.get(userId);
  if (!clients) return;
  for (const client of Array.from(clients)) {
    if (
      client.jti !== exceptSessionId &&
      (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING)
    ) {
      client.close(WS_CLOSE_SESSION_REVOKED, "Sessions revoked");
    }
  }
}

onSessionSecurityEvent((event) => {
  if (event.type === "session.revoked") {
    disconnectSession(event.sessionId);
    return;
  }
  if (event.type === "user.sessions.revoked") {
    disconnectUser(event.userId, event.exceptSessionId);
    return;
  }

  const clients = clientsByUser.get(event.userId);
  if (!clients) return;
  for (const client of Array.from(clients)) {
    if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
      client.close(WS_CLOSE_USER_BANNED, "Account banned");
    }
  }
});

function isSpam(client: Client) {
  const now = Date.now();
  client.sentAt = (client.sentAt ?? []).filter((ts) => now - ts < 60_000);
  if (client.sentAt.length >= 15) return true;
  client.sentAt.push(now);
  return false;
}

export function notifyOrderEvent(userId: string, payload: unknown) {
  const clients = clientsByUser.get(userId);
  if (!clients) return;
  for (const client of clients) sendJson(client, payload);
}

export function broadcastConversation(conversationId: string, payload: unknown) {
  const clients = clientsByConversation.get(conversationId);
  if (!clients) return;
  for (const client of clients) sendJson(client, payload);
}

export function isUserOnline(userId: string) {
  return (clientsByUser.get(userId)?.size ?? 0) > 0;
}

// Presence broadcast intentionally omitted: broadcasting to every connected user on
// each connect/disconnect is O(N) — at 5k connections this generates 5k sends per event.
// For per-conversation presence, emit to conversation room members only (future work).

// NOTE: This WS server uses in-memory connection maps (clientsByUser, etc.).
// For multi-replica deployments, WS events only reach clients on the same replica.
// Strategy options:
//   1. Sticky sessions (recommended for Stage 1): configure the load balancer to pin
//      each user to one replica by cookie or IP. Local rooms work correctly within one replica.
//   2. Redis pub/sub: publish chat/order events to a channel; all replicas subscribe and
//      fan out to their own connected clients. Needed if sticky sessions are not feasible.
const HEARTBEAT_INTERVAL_MS = 30_000;

const incomingMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("join_conversation"),
    conversationId: z.string().uuid()
  }),
  z.object({
    type: z.literal("leave_conversation"),
    conversationId: z.string().uuid()
  }),
  z.object({
    type: z.literal("message"),
    clientMessageId: z.string().uuid(),
    conversationId: z.string().uuid(),
    body: z.string().trim().min(1).max(3000),
    attachmentId: z.null().optional(),
    attachmentUrl: z.string().url().max(2048).optional()
  })
]);

function sendMessageError(
  client: Client,
  clientMessageId: string,
  input: { code?: string; message: string; retryable: boolean }
) {
  sendJson(client, {
    type: "message_error",
    clientMessageId,
    ...input
  });
}

export function attachWebSocketServer(server: http.Server) {
  const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 64 * 1024 });

  // Server-side heartbeat: ping every 30 s; terminate clients that miss a pong.
  // This cleans up zombie connections (mobile sleep, NAT timeouts) without waiting for
  // a TCP RST, which prevents active-connection count from drifting up over time.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients as Set<Client>) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);

  wss.on("close", () => clearInterval(heartbeat));

  wss.on("connection", async (client: Client, req) => {
    client.isAlive = true;
    client.on("pong", () => { client.isAlive = true; });

    try {
      if (!isOriginAllowed(req)) throw new Error("Origin not allowed");

      const { userId, jti, emailVerified } = await authenticateHandshake(req);
      if ((clientsByUser.get(userId)?.size ?? 0) >= MAX_CONNECTIONS_PER_USER) {
        throw new Error("Too many connections");
      }
      client.userId = userId;
      client.jti = jti;
      client.emailVerified = emailVerified;
      client.rooms = new Set();
      const sameSession = clientsByJti.get(jti) ?? new Set<Client>();
      sameSession.add(client);
      clientsByJti.set(jti, sameSession);

      const userClients = clientsByUser.get(client.userId) ?? new Set<Client>();
      userClients.add(client);
      clientsByUser.set(client.userId, userClients);

      wsConnectionsActive.inc();
      sendJson(client, { type: "connected" });

      client.on("message", (raw) => {
        void (async () => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(raw.toString());
          } catch {
            wsMessagesTotal.labels("malformed").inc();
            sendJson(client, { type: "error", message: "Malformed websocket message" });
            return;
          }

          const validated = incomingMessageSchema.safeParse(parsed);
          if (!validated.success) {
            wsMessagesTotal.labels("invalid").inc();
            const candidate = parsed as { type?: unknown; clientMessageId?: unknown };
            if (
              candidate?.type === "message" &&
              typeof candidate.clientMessageId === "string"
            ) {
              sendMessageError(client, candidate.clientMessageId, {
                code: "invalid_message",
                message: "Invalid message",
                retryable: false
              });
            } else {
              sendJson(client, { type: "error", message: "Malformed websocket message" });
            }
            return;
          }

          const msg = validated.data;
          wsMessagesTotal.labels(msg.type).inc();

          if (msg.type === "join_conversation") {
            if (client.rooms?.has(msg.conversationId)) {
              sendJson(client, {
                type: "joined_conversation",
                conversationId: msg.conversationId
              });
              return;
            }
            if (!(await canAccessConversation(msg.conversationId, client.userId!))) {
              sendJson(client, {
                type: "error",
                code: "conversation_forbidden",
                message: "Cannot join conversation"
              });
              return;
            }
            // Re-check after the asynchronous access query so concurrent join messages
            // cannot race past the per-connection room ceiling.
            if ((client.rooms?.size ?? 0) >= env.WS_MAX_ROOMS_PER_CONNECTION) {
              sendJson(client, {
                type: "error",
                code: "room_limit",
                message: "Conversation room limit reached"
              });
              return;
            }
            joinConversation(client, msg.conversationId);
            sendJson(client, {
              type: "joined_conversation",
              conversationId: msg.conversationId
            });
            return;
          }

          if (msg.type === "leave_conversation") {
            leaveConversation(client, msg.conversationId);
            sendJson(client, {
              type: "left_conversation",
              conversationId: msg.conversationId
            });
            return;
          }

          if (!client.emailVerified) {
            sendMessageError(client, msg.clientMessageId, {
              code: "email_not_verified",
              message: "Please verify your email to send messages",
              retryable: false
            });
            return;
          }
          if (isSpam(client)) {
            sendMessageError(client, msg.clientMessageId, {
              code: "message_rate_limited",
              message: "Slow down",
              retryable: true
            });
            return;
          }

          try {
            const saved = await sendMessage({
              conversationId: msg.conversationId,
              senderId: client.userId!,
              body: msg.body,
              attachmentUrl: msg.attachmentUrl
            });
            // ACK is queued before the room broadcast so the sender can replace its
            // optimistic row before receiving the normal conversation event.
            sendJson(client, {
              type: "message_ack",
              clientMessageId: msg.clientMessageId,
              message: saved
            });
          } catch (sendError) {
            const code = sendError instanceof ApiError ? sendError.code : undefined;
            const message =
              sendError instanceof ApiError
                ? sendError.message
                : "Cannot message this conversation";
            sendMessageError(client, msg.clientMessageId, {
              code,
              message,
              retryable:
                !(sendError instanceof ApiError) ||
                sendError.status === 429 ||
                sendError.status >= 500
            });
          }
        })().catch((error) => {
          logger.error({ error, userId: client.userId }, "ws_message_handler_failed");
          sendJson(client, {
            type: "error",
            code: "internal_error",
            message: "Could not process websocket message"
          });
        });
      });

      client.on("close", () => {
        wsConnectionsActive.dec();
        leaveAll(client);
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : "unknown";
      wsConnectionFailuresTotal.labels(reason.slice(0, 64)).inc();
      client.close(1008, "Unauthorized");
    }
  });

  return wss;
}
