import http from "node:http";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import bcrypt from "bcryptjs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { WebSocket, type RawData } from "ws";
import { createApp } from "../src/app.js";
import { getRedis } from "../src/common/redis.js";
import { pool } from "../src/db/pool.js";
import { issueSession, revokeSession } from "../src/modules/auth/session.service.js";
import {
  attachWebSocketServer,
  sendJson,
  WS_CLOSE_SESSION_REVOKED,
  WS_CLOSE_SLOW_CLIENT
} from "../src/modules/chat/ws.service.js";
import { closeDb, createConversation, createUser, resetDb } from "./fixtures.js";

/**
 * WebSocket ticket authentication: one-time Redis-backed tickets carry an authenticated
 * session to the WS handshake (cross-domain safe), with same-origin cookie fallback.
 */

const app = createApp();
let server: http.Server;
let baseUrl: string;
let wsUrl: string;
const liveSockets = new Set<WebSocket>();

beforeAll(async () => {
  server = http.createServer(app);
  attachWebSocketServer(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
  wsUrl = `ws://127.0.0.1:${port}/ws`;
});

beforeEach(resetDb);
afterEach(() => {
  for (const socket of liveSockets) socket.terminate();
  liveSockets.clear();
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await getRedis()?.quit();
  await closeDb();
});

async function sessionFor(role: "user" | "admin" = "user") {
  const userId = await createUser(role);
  const session = await issueSession(userId, role);
  return {
    userId,
    jti: session.jti,
    cookie: [`access_token=${session.accessToken}`, `csrf_token=${session.csrfToken}`].join("; "),
    csrf: session.csrfToken
  };
}

async function getTicket(session: Awaited<ReturnType<typeof sessionFor>>) {
  const response = await request(app)
    .post("/auth/ws-ticket")
    .set("Cookie", session.cookie)
    .set("X-CSRF-Token", session.csrf);
  expect(response.status).toBe(201);
  expect(typeof response.body.ticket).toBe("string");
  return response.body.ticket as string;
}

function connect(url: string, headers: Record<string, string> = {}) {
  return new Promise<{ outcome: "connected" | "closed"; code?: number }>((resolve) => {
    const socket = new WebSocket(url, { headers });
    const timer = setTimeout(() => {
      socket.terminate();
      resolve({ outcome: "closed" });
    }, 4000);
    socket.on("message", (raw) => {
      const payload = JSON.parse(raw.toString());
      if (payload.type === "connected") {
        clearTimeout(timer);
        socket.close();
        resolve({ outcome: "connected" });
      }
    });
    socket.on("close", (code) => {
      clearTimeout(timer);
      resolve({ outcome: "closed", code });
    });
    socket.on("error", () => {
      /* close event follows */
    });
  });
}

function connectLive(url: string, headers: Record<string, string> = {}) {
  return new Promise<WebSocket>((resolve, reject) => {
    const socket = new WebSocket(url, { headers });
    liveSockets.add(socket);
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error("Timed out waiting for websocket connection"));
    }, 4000);
    socket.on("message", (raw) => {
      const payload = JSON.parse(raw.toString());
      if (payload.type !== "connected") return;
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("close", (code) => {
      liveSockets.delete(socket);
      clearTimeout(timer);
      if (socket.readyState !== WebSocket.OPEN) {
        reject(new Error(`Websocket closed before connecting (${code})`));
      }
    });
    socket.on("error", () => {
      /* close event rejects if the handshake never completed */
    });
  });
}

function waitForPayload(
  socket: WebSocket,
  predicate: (payload: Record<string, unknown>) => boolean
) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for websocket payload"));
    }, 4000);
    const onMessage = (raw: RawData) => {
      const payload = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (!predicate(payload)) return;
      cleanup();
      resolve(payload);
    };
    const onClose = () => {
      cleanup();
      reject(new Error("Websocket closed before the expected payload"));
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("message", onMessage);
      socket.off("close", onClose);
    };
    socket.on("message", onMessage);
    socket.on("close", onClose);
  });
}

function waitForClose(socket: WebSocket) {
  return new Promise<{ code: number; reason: string }>((resolve) => {
    socket.once("close", (code, reason) => {
      resolve({ code, reason: reason.toString() });
    });
  });
}

function cookieValue(setCookieHeader: string[] | undefined, name: string) {
  const line = setCookieHeader?.find((cookie) => cookie.startsWith(`${name}=`));
  return line?.split(";")[0].slice(name.length + 1);
}

describe("ws tickets", () => {
  it("requires authentication to issue a ticket", async () => {
    // The CSRF middleware rejects the tokenless POST with 403 before auth returns 401 -
    // either way an anonymous caller cannot mint a ticket.
    const response = await request(app).post("/auth/ws-ticket");
    expect([401, 403]).toContain(response.status);
    expect(response.body.ticket).toBeUndefined();
  });

  it("connects with a valid ticket and no cookies", async () => {
    const session = await sessionFor();
    const ticket = await getTicket(session);
    const result = await connect(`${wsUrl}?ticket=${encodeURIComponent(ticket)}`);
    expect(result.outcome).toBe("connected");
  });

  it("rejects a reused ticket", async () => {
    const session = await sessionFor();
    const ticket = await getTicket(session);
    expect((await connect(`${wsUrl}?ticket=${encodeURIComponent(ticket)}`)).outcome).toBe("connected");
    const replay = await connect(`${wsUrl}?ticket=${encodeURIComponent(ticket)}`);
    expect(replay.outcome).toBe("closed");
    expect(replay.code).toBe(1008);
  });

  it("rejects an unknown ticket", async () => {
    const result = await connect(`${wsUrl}?ticket=not-a-real-ticket`);
    expect(result.outcome).toBe("closed");
    expect(result.code).toBe(1008);
  });

  it("rejects a ticket whose session was revoked after issuing", async () => {
    const session = await sessionFor();
    const ticket = await getTicket(session);
    await revokeSession(session.jti);
    const result = await connect(`${wsUrl}?ticket=${encodeURIComponent(ticket)}`);
    expect(result.outcome).toBe("closed");
    expect(result.code).toBe(1008);
  });

  it("rejects a browser Origin outside the allowlist even with a valid ticket", async () => {
    const session = await sessionFor();
    const ticket = await getTicket(session);
    const result = await connect(`${wsUrl}?ticket=${encodeURIComponent(ticket)}`, { Origin: "https://evil.example" });
    expect(result.outcome).toBe("closed");
    expect(result.code).toBe(1008);
  });

  it("accepts the configured frontend Origin", async () => {
    const session = await sessionFor();
    const ticket = await getTicket(session);
    const result = await connect(`${wsUrl}?ticket=${encodeURIComponent(ticket)}`, { Origin: "http://localhost:3000" });
    expect(result.outcome).toBe("connected");
  });

  it("still authenticates same-origin connections via the httpOnly cookie", async () => {
    const session = await sessionFor();
    const result = await connect(wsUrl, { Cookie: session.cookie });
    expect(result.outcome).toBe("connected");
  });
});

describe("realtime delivery and connection limits", () => {
  it("acknowledges a saved message with the same clientMessageId", async () => {
    const buyer = await sessionFor();
    const sellerId = await createUser();
    await pool.query(`update users set email_verified_at = now() where id = $1`, [buyer.userId]);
    const conversationId = await createConversation(buyer.userId, sellerId);
    const ticket = await getTicket(buyer);
    const socket = await connectLive(`${wsUrl}?ticket=${encodeURIComponent(ticket)}`);

    const joined = waitForPayload(
      socket,
      (payload) =>
        payload.type === "joined_conversation" &&
        payload.conversationId === conversationId
    );
    socket.send(JSON.stringify({ type: "join_conversation", conversationId }));
    await joined;

    const clientMessageId = randomUUID();
    const acknowledged = waitForPayload(
      socket,
      (payload) =>
        payload.type === "message_ack" &&
        payload.clientMessageId === clientMessageId
    );
    socket.send(
      JSON.stringify({
        type: "message",
        clientMessageId,
        conversationId,
        body: "saved only after ack",
        attachmentId: null
      })
    );
    const ack = await acknowledged;
    expect(ack.clientMessageId).toBe(clientMessageId);
    expect((ack.message as { body: string }).body).toBe("saved only after ack");

    const stored = await pool.query<{ count: string }>(
      `select count(*) from messages where conversation_id = $1 and body = $2`,
      [conversationId, "saved only after ack"]
    );
    expect(Number(stored.rows[0].count)).toBe(1);
  });

  it("refuses rooms beyond WS_MAX_ROOMS_PER_CONNECTION", async () => {
    const buyer = await sessionFor();
    const conversationIds: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const sellerId = await createUser();
      conversationIds.push(await createConversation(buyer.userId, sellerId));
    }
    const ticket = await getTicket(buyer);
    const socket = await connectLive(`${wsUrl}?ticket=${encodeURIComponent(ticket)}`);

    for (const conversationId of conversationIds.slice(0, 3)) {
      const joined = waitForPayload(
        socket,
        (payload) =>
          payload.type === "joined_conversation" &&
          payload.conversationId === conversationId
      );
      socket.send(JSON.stringify({ type: "join_conversation", conversationId }));
      await joined;
    }

    const rejected = waitForPayload(
      socket,
      (payload) => payload.type === "error" && payload.code === "room_limit"
    );
    socket.send(
      JSON.stringify({
        type: "join_conversation",
        conversationId: conversationIds[3]
      })
    );
    expect((await rejected).code).toBe("room_limit");

    const left = waitForPayload(
      socket,
      (payload) =>
        payload.type === "left_conversation" &&
        payload.conversationId === conversationIds[0]
    );
    socket.send(
      JSON.stringify({
        type: "leave_conversation",
        conversationId: conversationIds[0]
      })
    );
    await left;

    const joinedAfterLeave = waitForPayload(
      socket,
      (payload) =>
        payload.type === "joined_conversation" &&
        payload.conversationId === conversationIds[3]
    );
    socket.send(
      JSON.stringify({
        type: "join_conversation",
        conversationId: conversationIds[3]
      })
    );
    await joinedAfterLeave;
  });

  it("closes the old websocket on password change while the new session still connects", async () => {
    const oldSession = await sessionFor();
    const currentPassword = "current-password-123";
    const nextPassword = "Next-password-456!";
    await pool.query(`update users set password_hash = $2 where id = $1`, [
      oldSession.userId,
      await bcrypt.hash(currentPassword, 4)
    ]);

    const oldTicket = await getTicket(oldSession);
    const oldSocket = await connectLive(
      `${wsUrl}?ticket=${encodeURIComponent(oldTicket)}`
    );
    const oldClosed = waitForClose(oldSocket);
    const changed = await request(app)
      .post("/users/me/password")
      .set("Cookie", oldSession.cookie)
      .set("X-CSRF-Token", oldSession.csrf)
      .send({ currentPassword, newPassword: nextPassword });
    expect(changed.status).toBe(200);
    expect(changed.headers["x-session-rotated"]).toBe("true");
    expect((await oldClosed).code).toBe(WS_CLOSE_SESSION_REVOKED);

    const setCookies = changed.headers["set-cookie"] as unknown as string[];
    const accessToken = cookieValue(setCookies, "access_token");
    const csrfToken = cookieValue(setCookies, "csrf_token");
    expect(accessToken).toBeTruthy();
    expect(csrfToken).toBeTruthy();

    const newTicketResponse = await request(app)
      .post("/auth/ws-ticket")
      .set("Cookie", `access_token=${accessToken}; csrf_token=${csrfToken}`)
      .set("X-CSRF-Token", csrfToken!);
    expect(newTicketResponse.status).toBe(201);
    const newSocket = await connectLive(
      `${wsUrl}?ticket=${encodeURIComponent(newTicketResponse.body.ticket)}`
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(newSocket.readyState).toBe(WebSocket.OPEN);
  });

  it("closes a slow client instead of adding to its outbound buffer", () => {
    const close = vi.fn();
    const send = vi.fn();
    const slowClient = {
      readyState: WebSocket.OPEN,
      bufferedAmount: 1025,
      close,
      send
    } as unknown as WebSocket;

    expect(sendJson(slowClient, { type: "notification" })).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledWith(WS_CLOSE_SLOW_CLIENT, "Slow client");
  });
});
