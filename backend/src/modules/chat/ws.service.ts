import type http from "node:http";
import jwt from "jsonwebtoken";
import { WebSocketServer, WebSocket } from "ws";
import { env } from "../../config/env.js";
import { pool } from "../../db/pool.js";
import { getRedis } from "../../common/redis.js";
import { ACCESS_COOKIE } from "../../common/cookies.js";

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
};

type JwtPayload = {
  sub: string;
  jti: string;
};

const clientsByUser = new Map<string, Set<Client>>();
const clientsByConversation = new Map<string, Set<Client>>();
const clientsByJti = new Map<string, Client>();

async function authenticateSocket(token: string) {
  const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
  if (!payload.jti) throw new Error("Missing session id");

  const redis = getRedis();
  if (redis) {
    const exists = await redis.exists(`session:${payload.jti}`);
    if (!exists) throw new Error("Session expired");
  }

  const result = await pool.query<{ id: string; isBanned: boolean; emailVerified: boolean }>(
    `select id, is_banned as "isBanned",
            (email_verified_at is not null or telegram_id is not null) as "emailVerified"
     from users where id = $1`,
    [payload.sub]
  );
  const user = result.rows[0];
  if (!user) throw new Error("Invalid user");
  if (user.isBanned) throw new Error("Account is banned");

  return { userId: user.id, jti: payload.jti, emailVerified: user.emailVerified };
}

function sendJson(client: WebSocket, payload: unknown) {
  if (client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify(payload));
  }
}

async function canAccessConversation(conversationId: string, userId: string) {
  const result = await pool.query(
    `select 1 from conversations where id = $1 and (buyer_id = $2 or seller_id = $2)`,
    [conversationId, userId]
  );
  return Boolean(result.rows[0]);
}

async function saveMessage(input: { conversationId: string; senderId: string; body: string; attachmentUrl?: string }) {
  const result = await pool.query(
    `insert into messages(conversation_id, sender_id, body, attachment_url)
     values ($1, $2, $3, $4)
     returning id, conversation_id as "conversationId", sender_id as "senderId",
               (select display_name from users where id = $2) as "senderDisplayName",
               body, attachment_url as "attachmentUrl", created_at as "createdAt"`,
    [input.conversationId, input.senderId, input.body, input.attachmentUrl ?? null]
  );
  return result.rows[0];
}

async function notifyMessageRecipient(input: { conversationId: string; senderId: string; body: string }) {
  const conversation = await pool.query(`select buyer_id, seller_id from conversations where id = $1`, [input.conversationId]);
  const row = conversation.rows[0] as { buyer_id: string; seller_id: string } | undefined;
  if (!row) return;
  const recipientId = row.buyer_id === input.senderId ? row.seller_id : row.buyer_id;
  const sender = await pool.query(`select display_name from users where id = $1`, [input.senderId]);
  const result = await pool.query(
    `insert into notifications(user_id, type, title, body, conversation_id)
     values ($1, 'message', 'Новое сообщение', $2, $3)
     returning id, user_id as "userId", type, title, body, conversation_id as "conversationId",
               read_at as "readAt", created_at as "createdAt"`,
    [recipientId, `${sender.rows[0]?.display_name ?? "Участник"}: ${input.body.slice(0, 120)}`, input.conversationId]
  );
  notifyOrderEvent(recipientId, { type: "notification", notification: result.rows[0] });
}

function joinConversation(client: Client, conversationId: string) {
  client.rooms ??= new Set();
  client.rooms.add(conversationId);
  const room = clientsByConversation.get(conversationId) ?? new Set<Client>();
  room.add(client);
  clientsByConversation.set(conversationId, room);
}

function leaveAll(client: Client) {
  if (client.userId) {
    const clients = clientsByUser.get(client.userId);
    if (clients) {
      clients.delete(client);
      if (clients.size === 0) {
        clientsByUser.delete(client.userId);
        broadcastPresence(client.userId, false);
      }
    }
  }
  if (client.jti) clientsByJti.delete(client.jti);
  for (const room of client.rooms ?? []) {
    clientsByConversation.get(room)?.delete(client);
  }
}

export function disconnectSession(jti: string) {
  const client = clientsByJti.get(jti);
  if (client) client.close(1008, "Session revoked");
}

export function disconnectUser(userId: string) {
  const clients = clientsByUser.get(userId);
  if (!clients) return;
  for (const client of Array.from(clients)) client.close(1008, "Account banned");
}

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

function broadcastPresence(userId: string, online: boolean) {
  const clients = Array.from(clientsByUser.values()).flatMap((set) => Array.from(set));
  for (const client of clients) {
    sendJson(client, { type: "presence", userId, online });
  }
}

export function attachWebSocketServer(server: http.Server) {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", async (client: Client, req) => {
    try {
      // The access token lives in an httpOnly cookie, so the browser attaches it to the
      // WS handshake automatically — no token ever needs to be readable by frontend JS.
      const token = readCookie(req.headers.cookie, ACCESS_COOKIE);
      if (!token) throw new Error("Missing token");

      const { userId, jti, emailVerified } = await authenticateSocket(token);
      client.userId = userId;
      client.jti = jti;
      client.emailVerified = emailVerified;
      client.rooms = new Set();
      clientsByJti.set(jti, client);

      const hadClients = (clientsByUser.get(client.userId)?.size ?? 0) > 0;
      const userClients = clientsByUser.get(client.userId) ?? new Set<Client>();
      userClients.add(client);
      clientsByUser.set(client.userId, userClients);
      if (!hadClients) broadcastPresence(client.userId, true);

      sendJson(client, { type: "connected" });

      client.on("message", async (raw) => {
        try {
          const msg = JSON.parse(raw.toString()) as {
            type: "join_conversation" | "message";
            conversationId?: string;
            body?: string;
            attachmentUrl?: string;
          };

          if (msg.type === "join_conversation") {
            if (!msg.conversationId || !(await canAccessConversation(msg.conversationId, client.userId!))) {
              return sendJson(client, { type: "error", message: "Cannot join conversation" });
            }
            joinConversation(client, msg.conversationId);
            return sendJson(client, { type: "joined_conversation", conversationId: msg.conversationId });
          }

          if (msg.type === "message") {
            if (!client.emailVerified) {
              return sendJson(client, {
                type: "error",
                code: "email_not_verified",
                message: "Please verify your email to send messages"
              });
            }
            if (isSpam(client)) return sendJson(client, { type: "error", message: "Slow down" });
            const body = (msg.body ?? "").trim();
            if (!msg.conversationId || !body || body.length > 3000) {
              return sendJson(client, { type: "error", message: "Invalid message" });
            }
            if (!(await canAccessConversation(msg.conversationId, client.userId!))) {
              return sendJson(client, { type: "error", message: "Cannot message this conversation" });
            }
            const saved = await saveMessage({
              conversationId: msg.conversationId,
              senderId: client.userId!,
              body,
              attachmentUrl: msg.attachmentUrl
            });
            broadcastConversation(msg.conversationId, { type: "message", message: saved });
            await notifyMessageRecipient({ conversationId: msg.conversationId, senderId: client.userId!, body });
          }
        } catch {
          sendJson(client, { type: "error", message: "Malformed websocket message" });
        }
      });

      client.on("close", () => leaveAll(client));
    } catch {
      client.close(1008, "Unauthorized");
    }
  });

  return wss;
}
