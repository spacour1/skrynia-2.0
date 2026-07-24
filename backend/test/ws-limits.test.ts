import http from "node:http";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { WebSocket, type RawData } from "ws";

// Low ceilings must be visible to config/env before the app's module graph loads.
process.env.WS_MAX_FRAMES_PER_MIN = "10";
process.env.WS_MAX_JOINS_PER_MIN = "3";
process.env.WS_MAX_CONCURRENT_HANDLERS = "2";
process.env.PG_POOL_MAX = "2";

const { createApp } = await import("../src/app.js");
const { getRedis } = await import("../src/common/redis.js");
const { pool } = await import("../src/db/pool.js");
const { issueSession } = await import("../src/modules/auth/session.service.js");
const { attachWebSocketServer, broadcastConversation, WS_CLOSE_ABUSE } = await import(
  "../src/modules/chat/ws.service.js"
);
const { closeDb, createConversation, createUser, resetDb } = await import("./fixtures.js");

const app = createApp();
let server: http.Server;
let wsUrl: string;
const liveSockets = new Set<WebSocket>();

beforeAll(async () => {
  server = http.createServer(app);
  attachWebSocketServer(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
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

async function connectedSocket() {
  const userId = await createUser("user");
  await (await import("../src/db/pool.js")).pool.query(
    `update users set email_verified_at = now() where id = $1`,
    [userId]
  );
  const session = await issueSession(userId, "user");
  const ticketResponse = await request(app)
    .post("/auth/ws-ticket")
    .set("Cookie", [`access_token=${session.accessToken}`, `csrf_token=${session.csrfToken}`].join("; "))
    .set("X-CSRF-Token", session.csrfToken);
  expect(ticketResponse.status).toBe(201);

  const socket = new WebSocket(`${wsUrl}?ticket=${ticketResponse.body.ticket}`);
  liveSockets.add(socket);
  const events: Array<Record<string, unknown>> = [];
  let closeCode: number | undefined;
  socket.on("message", (raw: RawData) => {
    events.push(JSON.parse(raw.toString()));
  });
  socket.on("close", (code) => {
    closeCode = code;
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("ws connect timeout")), 4000);
    socket.on("message", function onFirst(raw: RawData) {
      if (JSON.parse(raw.toString()).type === "connected") {
        clearTimeout(timer);
        socket.off("message", onFirst);
        resolve();
      }
    });
    socket.on("error", reject);
  });

  return {
    userId,
    socket,
    events,
    getCloseCode: () => closeCode,
    send: (payload: unknown) => socket.send(JSON.stringify(payload)),
    waitFor: async (predicate: (event: Record<string, unknown>) => boolean, timeoutMs = 3000) => {
      const startedAt = Date.now();
      for (;;) {
        const match = events.find(predicate);
        if (match) return match;
        if (Date.now() - startedAt > timeoutMs) throw new Error("ws event timeout");
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
  };
}

describe("websocket control-frame limits", () => {
  it("bounds concurrent handlers before they can fan out into database work", async () => {
    const client = await connectedSocket();
    const blockers = await Promise.all([pool.connect(), pool.connect()]);

    try {
      // Every valid frame first performs the durable session-version query. With the
      // entire two-connection pool held here, the first two handlers stay in flight,
      // making the per-socket ceiling deterministic instead of timing-dependent.
      client.send({ type: "leave_conversation", conversationId: randomUUID() });
      client.send({ type: "leave_conversation", conversationId: randomUUID() });
      client.send({ type: "leave_conversation", conversationId: randomUUID() });

      await client.waitFor((event) => event.code === "busy");
      expect(client.events.filter((event) => event.code === "busy")).toHaveLength(1);
      expect(
        client.events.filter((event) => event.type === "left_conversation")
      ).toHaveLength(0);
    } finally {
      for (const blocker of blockers) blocker.release();
    }

    await client.waitFor(
      () =>
        client.events.filter((event) => event.type === "left_conversation").length === 2
    );
    expect(
      client.events.filter((event) => event.type === "left_conversation")
    ).toHaveLength(2);
  });

  it("rejects join floods with a dedicated error before hitting the database", async () => {
    const client = await connectedSocket();

    // Budget is 3: the first three (forbidden) joins consume it, the fourth is refused
    // by the join limiter itself. Sent sequentially so the concurrent-handler bound
    // (also low in this file) never interferes.
    for (let i = 0; i < 3; i += 1) {
      client.send({ type: "join_conversation", conversationId: randomUUID() });
      await client.waitFor(
        () => client.events.filter((event) => event.code === "conversation_forbidden").length >= i + 1
      );
    }
    client.send({ type: "join_conversation", conversationId: randomUUID() });
    await client.waitFor((event) => event.code === "join_rate_limited");
    const forbidden = client.events.filter((event) => event.code === "conversation_forbidden");
    expect(forbidden).toHaveLength(3);
  });

  it("closes the connection on a sustained frame flood", async () => {
    const client = await connectedSocket();

    for (let i = 0; i < 30; i += 1) {
      client.send({ type: "leave_conversation", conversationId: randomUUID() });
    }
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        if (client.getCloseCode() !== undefined) {
          clearInterval(timer);
          resolve();
        }
      }, 25);
    });
    expect(client.getCloseCode()).toBe(WS_CLOSE_ABUSE);
    expect(client.events.some((event) => event.code === "frame_rate_limited")).toBe(true);
  });

  it("duplicate join is idempotent and leaves fully remove membership", async () => {
    const client = await connectedSocket();
    const other = await createUser("user");
    const conversationId = await createConversation(client.userId, other);

    client.send({ type: "join_conversation", conversationId });
    await client.waitFor((event) => event.type === "joined_conversation");
    client.send({ type: "join_conversation", conversationId });
    await client.waitFor(
      () => client.events.filter((event) => event.type === "joined_conversation").length >= 2
    );

    // One leave undoes even a double join - membership is a set, not a counter.
    client.send({ type: "leave_conversation", conversationId });
    await client.waitFor((event) => event.type === "left_conversation");

    await broadcastConversation(conversationId, { type: "test_broadcast", conversationId });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(client.events.some((event) => event.type === "test_broadcast")).toBe(false);
  });

  it("a normal reconnect can rejoin its room", async () => {
    const first = await connectedSocket();
    const other = await createUser("user");
    const conversationId = await createConversation(first.userId, other);
    first.send({ type: "join_conversation", conversationId });
    await first.waitFor((event) => event.type === "joined_conversation");
    first.socket.terminate();

    const second = await connectedSocket();
    const conversationId2 = await createConversation(second.userId, other);
    second.send({ type: "join_conversation", conversationId: conversationId2 });
    const joined = await second.waitFor((event) => event.type === "joined_conversation");
    expect(joined.conversationId).toBe(conversationId2);
  });
});
