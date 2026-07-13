import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { WebSocket } from "ws";
import { createApp } from "../src/app.js";
import { getRedis } from "../src/common/redis.js";
import { issueSession, revokeSession } from "../src/modules/auth/session.service.js";
import { attachWebSocketServer } from "../src/modules/chat/ws.service.js";
import { closeDb, createUser, resetDb } from "./fixtures.js";

/**
 * WebSocket ticket authentication: one-time Redis-backed tickets carry an authenticated
 * session to the WS handshake (cross-domain safe), with same-origin cookie fallback.
 */

const app = createApp();
let server: http.Server;
let baseUrl: string;
let wsUrl: string;

beforeAll(async () => {
  server = http.createServer(app);
  attachWebSocketServer(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
  wsUrl = `ws://127.0.0.1:${port}/ws`;
});

beforeEach(resetDb);
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
