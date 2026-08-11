import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket, type RawData } from "ws";

const mocks = vi.hoisted(() => {
  const metric = {
    inc: vi.fn(),
    dec: vi.fn(),
    labels: vi.fn()
  };
  metric.labels.mockReturnValue(metric);

  return {
    metric,
    poolQuery: vi.fn(),
    redisExists: vi.fn(),
    redisGet: vi.fn(),
    consumeWsTicket: vi.fn(),
    presenceRegister: vi.fn(),
    presenceUnregister: vi.fn(),
    sendMessage: vi.fn(),
    loggerWarn: vi.fn(),
    loggerError: vi.fn()
  };
});

vi.mock("../src/db/pool.js", () => ({
  pool: { query: mocks.poolQuery }
}));

vi.mock("../src/common/redis.js", () => ({
  getRedis: () => ({
    exists: mocks.redisExists,
    get: mocks.redisGet,
    pipeline: () => {
      const operations: Array<{ kind: "exists" | "get"; key: string }> = [];
      const pipeline = {
        exists(key: string) {
          operations.push({ kind: "exists", key });
          return pipeline;
        },
        get(key: string) {
          operations.push({ kind: "get", key });
          return pipeline;
        },
        async exec() {
          return Promise.all(operations.map(async (operation) => [
            null,
            operation.kind === "exists"
              ? await mocks.redisExists(operation.key)
              : await mocks.redisGet(operation.key)
          ]));
        }
      };
      return pipeline;
    }
  })
}));

vi.mock("../src/common/logger.js", () => ({
  logger: {
    warn: mocks.loggerWarn,
    error: mocks.loggerError
  }
}));

vi.mock("../src/common/metrics.js", () => ({
  wsConnectionsActive: mocks.metric,
  wsConnectionFailuresTotal: mocks.metric,
  wsFramesRejectedTotal: mocks.metric,
  wsMessagesTotal: mocks.metric,
  wsSlowClientsTotal: mocks.metric
}));

vi.mock("../src/modules/auth/ws-ticket.service.js", () => ({
  consumeWsTicket: mocks.consumeWsTicket
}));

vi.mock("../src/modules/auth/session-events.service.js", () => ({
  onSessionSecurityEvent: vi.fn(),
  publishSessionSecurityEvent: vi.fn()
}));

vi.mock("../src/modules/realtime/realtime-runtime.js", () => ({
  getPresenceService: () => ({
    register: mocks.presenceRegister,
    unregister: mocks.presenceUnregister,
    isUserOnline: vi.fn()
  }),
  onRealtimeEvent: vi.fn(),
  publishRealtimeEvent: vi.fn()
}));

vi.mock("../src/modules/chat/chat.service.js", () => ({
  sendMessageIdempotently: mocks.sendMessage
}));

const { attachWebSocketServer, WS_CLOSE_SESSION_REVOKED } = await import(
  "../src/modules/chat/ws.service.js"
);

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const identity = {
  userId: "00000000-0000-4000-8000-000000000001",
  jti: "session-id",
  sessionVersion: 1,
  emailVerified: true,
  createdAt: new Date(0).toISOString()
};

const aliveUserResult = {
  rows: [
    {
      id: identity.userId,
      isBanned: false,
      emailVerified: true,
      sessionVersion: 1
    }
  ]
};

type TestRuntime = {
  httpServer: http.Server;
  runtime: ReturnType<typeof attachWebSocketServer>;
  url: string;
  sockets: Set<WebSocket>;
};

const runtimes = new Set<TestRuntime>();

async function createRuntime() {
  const httpServer = http.createServer();
  const runtime = attachWebSocketServer(httpServer);
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const { port } = httpServer.address() as AddressInfo;
  const value: TestRuntime = {
    httpServer,
    runtime,
    url: `ws://127.0.0.1:${port}/ws?ticket=race-ticket`,
    sockets: new Set()
  };
  runtimes.add(value);
  return value;
}

function openSocket(testRuntime: TestRuntime) {
  const socket = new WebSocket(testRuntime.url);
  testRuntime.sockets.add(socket);
  socket.once("close", () => testRuntime.sockets.delete(socket));
  socket.on("error", () => {
    // A close event is the observable result for rejected/shutdown sockets.
  });
  return socket;
}

function waitForClose(socket: WebSocket) {
  return new Promise<{ code: number; reason: string }>((resolve) => {
    socket.once("close", (code, reason) => {
      resolve({ code, reason: reason.toString() });
    });
  });
}

function waitForConnected(socket: WebSocket) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Timed out waiting for connected frame")),
      2_000
    );
    socket.on("message", function onMessage(raw: RawData) {
      const payload = JSON.parse(raw.toString()) as { type?: string };
      if (payload.type !== "connected") return;
      clearTimeout(timer);
      socket.off("message", onMessage);
      resolve();
    });
  });
}

async function expectShutdownClose(
  closed: Promise<{ code: number; reason: string }>,
  shutdown: Promise<void>
) {
  await shutdown;
  await expect(closed).resolves.toEqual({
    code: 1001,
    reason: "Server shutting down"
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.metric.labels.mockReturnValue(mocks.metric);
  mocks.consumeWsTicket.mockResolvedValue(identity);
  mocks.redisExists.mockImplementation(async (key: string) => (
    key.startsWith("session_revoked:") ? 0 : 1
  ));
  mocks.redisGet.mockResolvedValue(null);
  mocks.poolQuery.mockResolvedValue(aliveUserResult);
  mocks.presenceRegister.mockResolvedValue(true);
  mocks.presenceUnregister.mockResolvedValue(undefined);
  mocks.sendMessage.mockResolvedValue({
    created: true,
    message: { id: "message-id" }
  });
});

afterEach(async () => {
  for (const testRuntime of runtimes) {
    testRuntime.runtime.forceClose();
    for (const socket of testRuntime.sockets) socket.terminate();
    if (testRuntime.httpServer.listening) {
      await new Promise<void>((resolve) => testRuntime.httpServer.close(() => resolve()));
    }
  }
  runtimes.clear();
});

describe("websocket shutdown admission races", () => {
  it("stops a ticket handshake at the first awaited boundary", async () => {
    const ticket = deferred<typeof identity>();
    mocks.consumeWsTicket.mockReturnValueOnce(ticket.promise);
    const testRuntime = await createRuntime();
    const socket = openSocket(testRuntime);
    await vi.waitFor(() => expect(mocks.consumeWsTicket).toHaveBeenCalledOnce());
    const closed = waitForClose(socket);

    const shutdown = testRuntime.runtime.beginShutdown();
    ticket.resolve(identity);

    await expectShutdownClose(closed, shutdown);
    expect(mocks.redisExists).not.toHaveBeenCalled();
    expect(mocks.poolQuery).not.toHaveBeenCalled();
    expect(mocks.presenceRegister).not.toHaveBeenCalled();
  });

  it("stops a ticket handshake after the Redis session boundary", async () => {
    const redisCheck = deferred<number>();
    mocks.redisExists.mockReturnValueOnce(redisCheck.promise);
    const testRuntime = await createRuntime();
    const socket = openSocket(testRuntime);
    await vi.waitFor(() => expect(mocks.redisExists).toHaveBeenCalledOnce());
    const closed = waitForClose(socket);

    const shutdown = testRuntime.runtime.beginShutdown();
    redisCheck.resolve(1);

    await expectShutdownClose(closed, shutdown);
    expect(mocks.poolQuery).not.toHaveBeenCalled();
    expect(mocks.presenceRegister).not.toHaveBeenCalled();
  });

  it("does not fall through to the database when Redis rejects during shutdown", async () => {
    const redisCheck = deferred<number>();
    mocks.redisExists.mockReturnValueOnce(redisCheck.promise);
    const testRuntime = await createRuntime();
    const socket = openSocket(testRuntime);
    await vi.waitFor(() => expect(mocks.redisExists).toHaveBeenCalledOnce());
    const closed = waitForClose(socket);

    const shutdown = testRuntime.runtime.beginShutdown();
    redisCheck.reject(new Error("redis unavailable"));

    await expectShutdownClose(closed, shutdown);
    expect(mocks.poolQuery).not.toHaveBeenCalled();
    expect(mocks.presenceRegister).not.toHaveBeenCalled();
  });

  it("rejects a new handshake when Redis cannot verify revocation state", async () => {
    mocks.redisExists.mockRejectedValueOnce(new Error("redis unavailable"));
    const testRuntime = await createRuntime();
    const socket = openSocket(testRuntime);
    const closed = waitForClose(socket);

    await expect(closed).resolves.toEqual({ code: 1008, reason: "Unauthorized" });
    expect(mocks.poolQuery).not.toHaveBeenCalled();
    expect(mocks.presenceRegister).not.toHaveBeenCalled();
  });

  it("stops a ticket handshake after the database session boundary", async () => {
    const userCheck = deferred<typeof aliveUserResult>();
    mocks.poolQuery.mockReturnValueOnce(userCheck.promise);
    const testRuntime = await createRuntime();
    const socket = openSocket(testRuntime);
    await vi.waitFor(() => expect(mocks.poolQuery).toHaveBeenCalledOnce());
    const closed = waitForClose(socket);

    const shutdown = testRuntime.runtime.beginShutdown();
    userCheck.resolve(aliveUserResult);

    await expectShutdownClose(closed, shutdown);
    expect(mocks.presenceRegister).not.toHaveBeenCalled();
  });

  it("waits for a racing presence register and its compensating unregister", async () => {
    const registration = deferred<boolean>();
    const unregistration = deferred<void>();
    mocks.presenceRegister.mockReturnValueOnce(registration.promise);
    mocks.presenceUnregister.mockReturnValueOnce(unregistration.promise);
    const testRuntime = await createRuntime();
    const socket = openSocket(testRuntime);
    await vi.waitFor(() => expect(mocks.presenceRegister).toHaveBeenCalledOnce());
    const closed = waitForClose(socket);

    let shutdownSettled = false;
    const shutdown = testRuntime.runtime.beginShutdown().then(() => {
      shutdownSettled = true;
    });
    registration.resolve(true);
    await vi.waitFor(() => expect(mocks.presenceUnregister).toHaveBeenCalledOnce());
    await Promise.resolve();
    expect(shutdownSettled).toBe(false);

    unregistration.resolve();
    await expectShutdownClose(closed, shutdown);
    expect(mocks.metric.inc).not.toHaveBeenCalled();
  });

  it("drains an admitted frame but stops it after its awaited auth boundary", async () => {
    const testRuntime = await createRuntime();
    const socket = openSocket(testRuntime);
    await waitForConnected(socket);
    const closed = waitForClose(socket);
    mocks.poolQuery.mockClear();
    const frameAuth = deferred<typeof aliveUserResult>();
    mocks.poolQuery.mockReturnValueOnce(frameAuth.promise);

    socket.send(
      JSON.stringify({
        type: "join_conversation",
        conversationId: "00000000-0000-4000-8000-000000000002"
      })
    );
    await vi.waitFor(() => expect(mocks.poolQuery).toHaveBeenCalledOnce());

    let shutdownSettled = false;
    const shutdown = testRuntime.runtime.beginShutdown().then(() => {
      shutdownSettled = true;
    });
    await Promise.resolve();
    expect(shutdownSettled).toBe(false);
    frameAuth.resolve(aliveUserResult);

    await expectShutdownClose(closed, shutdown);
    expect(mocks.poolQuery).toHaveBeenCalledOnce();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("closes an admitted socket before a mutation when Redis verification fails", async () => {
    const testRuntime = await createRuntime();
    const socket = openSocket(testRuntime);
    await waitForConnected(socket);
    const closed = waitForClose(socket);
    mocks.poolQuery.mockClear();
    mocks.redisExists.mockRejectedValueOnce(new Error("redis unavailable"));

    socket.send(
      JSON.stringify({
        type: "leave_conversation",
        conversationId: "00000000-0000-4000-8000-000000000002"
      })
    );

    await expect(closed).resolves.toEqual({
      code: WS_CLOSE_SESSION_REVOKED,
      reason: "Session revoked"
    });
    expect(mocks.poolQuery).not.toHaveBeenCalled();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("rejects frames delivered after the shutdown admission gate closes", async () => {
    const testRuntime = await createRuntime();
    const socket = openSocket(testRuntime);
    await waitForConnected(socket);
    const closed = waitForClose(socket);
    const serverSocket = Array.from(testRuntime.runtime.server.clients)[0];
    expect(serverSocket).toBeDefined();
    mocks.poolQuery.mockClear();

    const shutdown = testRuntime.runtime.beginShutdown();
    serverSocket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          type: "leave_conversation",
          conversationId: "00000000-0000-4000-8000-000000000002"
        })
      ),
      false
    );

    await expectShutdownClose(closed, shutdown);
    expect(mocks.poolQuery).not.toHaveBeenCalled();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });
});
