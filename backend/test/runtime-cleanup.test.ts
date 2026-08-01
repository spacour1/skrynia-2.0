import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  drainAuditWritesForShutdown
} from "../src/runtime/audit-drain.js";
import {
  createApiCleanup,
  POST_AUDIT_SHUTDOWN_RESERVE_MS
} from "../src/runtime/api-cleanup.js";
import { createApiShutdown } from "../src/runtime/api-shutdown.js";
import {
  runCleanupSteps,
  settleWithin
} from "../src/runtime/async.js";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function httpGet(port: number) {
  return new Promise<number>((resolve, reject) => {
    const request = http.get(
      { host: "127.0.0.1", port, path: "/", agent: false },
      (response) => {
        response.resume();
        response.once("end", () => resolve(response.statusCode ?? 0));
      }
    );
    request.once("error", reject);
    request.setTimeout(1_000, () => request.destroy(new Error("request timed out")));
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("bounded runtime settlement", () => {
  it("does not report a rejected drain as successful", async () => {
    await expect(
      settleWithin(Promise.reject(new Error("drain failed")), 1_000)
    ).resolves.toBe(false);
  });
});

describe("ordered runtime cleanup", () => {
  it("runs in order and still closes the pool after an earlier failure", async () => {
    const order: string[] = [];
    const closePool = vi.fn(() => {
      order.push("postgres");
    });

    await expect(
      runCleanupSteps([
        {
          name: "realtime",
          run: () => {
            order.push("realtime");
            throw new Error("subscriber close failed");
          }
        },
        {
          name: "redis",
          run: () => {
            order.push("redis");
          }
        },
        { name: "postgres", run: closePool }
      ])
    ).rejects.toBeInstanceOf(AggregateError);

    expect(order).toEqual(["realtime", "redis", "postgres"]);
    expect(closePool).toHaveBeenCalledTimes(1);
  });

  it("waits for a delayed audit drain before closing the database pool", async () => {
    const audit = deferred<boolean>();
    const order: string[] = [];
    const shutdownLogger = { warn: vi.fn() };
    const cleanup = createApiCleanup({
      stopRealtime: () => order.push("realtime"),
      closeJobQueue: () => order.push("queue"),
      closeRedis: () => order.push("redis"),
      drainAuditWrites: () => {
        order.push("audit:start");
        return audit.promise.then((successful) => {
          order.push("audit:end");
          return successful;
        });
      },
      closeDatabase: () => order.push("postgres"),
      closeErrorTracking: () => order.push("sentry"),
      shutdownLogger
    });
    const cleanupPromise = cleanup(Date.now() + 10_000);

    await vi.waitFor(() =>
      expect(order).toEqual(["realtime", "queue", "redis", "audit:start"])
    );
    audit.resolve(true);
    await cleanupPromise;

    expect(order).toEqual([
      "realtime",
      "queue",
      "redis",
      "audit:start",
      "audit:end",
      "postgres",
      "sentry"
    ]);
    expect(shutdownLogger.warn).not.toHaveBeenCalled();
  });

  it("continues cleanup after a bounded audit drain timeout", async () => {
    vi.useFakeTimers();
    const shutdownLogger = { warn: vi.fn() };
    const order: string[] = [];
    const cleanup = createApiCleanup({
      stopRealtime: () => order.push("realtime"),
      closeJobQueue: () => order.push("queue"),
      closeRedis: () => order.push("redis"),
      drainAuditWrites: () => {
        order.push("audit");
        return new Promise<boolean>(() => undefined);
      },
      closeDatabase: () => order.push("postgres"),
      closeErrorTracking: () => order.push("sentry"),
      shutdownLogger
    });
    const cleanupPromise = cleanup(
      Date.now() + POST_AUDIT_SHUTDOWN_RESERVE_MS + 100
    );

    await vi.advanceTimersByTimeAsync(100);
    await expect(cleanupPromise).resolves.toBeUndefined();

    expect(shutdownLogger.warn).toHaveBeenCalledTimes(1);
    expect(shutdownLogger.warn).toHaveBeenCalledWith(
      { timeoutMs: 100 },
      "audit_drain_timeout"
    );
    expect(order).toEqual([
      "realtime",
      "queue",
      "redis",
      "audit",
      "postgres",
      "sentry"
    ]);
  });

  it("skips the audit drain synchronously when the hard budget is exhausted", async () => {
    const shutdownLogger = { warn: vi.fn() };
    const drainAuditWrites = vi.fn(async () => true);
    const order: string[] = [];
    const cleanup = createApiCleanup({
      stopRealtime: () => order.push("realtime"),
      closeJobQueue: () => order.push("queue"),
      closeRedis: () => order.push("redis"),
      drainAuditWrites,
      closeDatabase: () => order.push("postgres"),
      closeErrorTracking: () => order.push("sentry"),
      shutdownLogger
    });

    await expect(cleanup(Date.now())).resolves.toBeUndefined();

    expect(drainAuditWrites).not.toHaveBeenCalled();
    expect(shutdownLogger.warn).toHaveBeenCalledWith(
      { timeoutMs: 0 },
      "audit_drain_timeout"
    );
    expect(order).toEqual([
      "realtime",
      "queue",
      "redis",
      "postgres",
      "sentry"
    ]);
  });
});

describe("audit drain outcome", () => {
  it("does not classify a failed audit drain as successful", async () => {
    const shutdownLogger = { warn: vi.fn() };

    await expect(
      drainAuditWritesForShutdown({
        drain: async () => false,
        timeoutMs: 1_000,
        shutdownLogger
      })
    ).resolves.toBe(false);

    expect(shutdownLogger.warn).toHaveBeenCalledWith(
      {},
      "audit_drain_incomplete"
    );
  });

  it("does not include a rejected drain error in the shutdown warning", async () => {
    const shutdownLogger = { warn: vi.fn() };

    await expect(
      drainAuditWritesForShutdown({
        drain: async () => {
          throw new Error("database detail must stay private");
        },
        timeoutMs: 1_000,
        shutdownLogger
      })
    ).resolves.toBe(false);

    expect(shutdownLogger.warn).toHaveBeenCalledTimes(1);
    expect(shutdownLogger.warn).toHaveBeenCalledWith({}, "audit_drain_failed");
    expect(JSON.stringify(shutdownLogger.warn.mock.calls)).not.toContain(
      "database detail must stay private"
    );
  });
});

describe("API shutdown coordinator", () => {
  it("returns one promise and starts WebSocket shutdown and cleanup once", async () => {
    const gate = deferred();
    const cleanup = vi.fn(() => gate.promise);
    const websocket = { beginShutdown: vi.fn(async () => undefined) };
    const markNotReady = vi.fn();
    const forceClose = vi.fn();
    const shutdown = createApiShutdown({
      server: http.createServer(),
      getWebSocket: () => websocket,
      graceMs: 1_000,
      hardTimeoutMs: 10_000,
      markNotReady,
      forceClose,
      cleanup
    });

    const first = shutdown();
    const second = shutdown();

    expect(second).toBe(first);
    expect(websocket.beginShutdown).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledTimes(1));

    gate.resolve();
    await first;

    expect(shutdown()).toBe(first);
    expect(markNotReady).toHaveBeenCalledTimes(1);
    expect(websocket.beginShutdown).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(forceClose).not.toHaveBeenCalled();
  });

  it("force-closes a drain that exceeds grace before starting cleanup", async () => {
    vi.useFakeTimers();
    const order: string[] = [];
    const server = {
      listening: true,
      close: vi.fn(),
      closeIdleConnections: vi.fn()
    } as unknown as http.Server;
    const shutdown = createApiShutdown({
      server,
      getWebSocket: () => null,
      graceMs: 100,
      hardTimeoutMs: 1_000,
      markNotReady: () => order.push("not-ready"),
      forceClose: () => order.push("force-close"),
      cleanup: async () => {
        order.push("cleanup");
      }
    });
    const shutdownPromise = shutdown();

    expect(order).toEqual(["not-ready"]);
    expect(server.close).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    await shutdownPromise;

    expect(order).toEqual(["not-ready", "force-close", "cleanup"]);
  });

  it("stops accepting new connections while an active request drains", async () => {
    const started = deferred();
    const release = deferred();
    let acceptedRequests = 0;
    const server = http.createServer((_request, response) => {
      acceptedRequests += 1;
      started.resolve();
      void release.promise.then(() => response.end("ok"));
    });
    let activeRequest: Promise<number> | null = null;
    let shutdownPromise: Promise<void> | null = null;
    const cleanup = vi.fn(async () => undefined);
    const markNotReady = vi.fn();
    const forceClose = vi.fn();

    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => reject(error);
        server.once("error", onError);
        server.listen(0, "127.0.0.1", () => {
          server.off("error", onError);
          resolve();
        });
      });
      const port = (server.address() as AddressInfo).port;
      activeRequest = httpGet(port);
      await started.promise;

      const shutdown = createApiShutdown({
        server,
        getWebSocket: () => null,
        graceMs: 5_000,
        hardTimeoutMs: 10_000,
        markNotReady,
        forceClose,
        cleanup
      });
      shutdownPromise = shutdown();
      expect(cleanup).not.toHaveBeenCalled();
      const connectionError = await httpGet(port).then(
        () => null,
        (error: NodeJS.ErrnoException) => error
      );
      expect(connectionError).toBeInstanceOf(Error);
      expect(connectionError?.message).not.toBe("request timed out");
      expect(["ECONNREFUSED", "ECONNRESET"]).toContain(connectionError?.code);
      expect(acceptedRequests).toBe(1);

      release.resolve();
      await expect(activeRequest).resolves.toBe(200);
      await expect(shutdownPromise).resolves.toBeUndefined();
      expect(markNotReady).toHaveBeenCalledTimes(1);
      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(forceClose).not.toHaveBeenCalled();
    } finally {
      release.resolve();
      server.closeAllConnections?.();
      if (server.listening) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
      await Promise.allSettled(
        [activeRequest, shutdownPromise].filter(
          (promise): promise is Promise<unknown> => Boolean(promise)
        )
      );
    }
  });
});
