import { describe, expect, it, vi } from "vitest";
import {
  RuntimeHeartbeat,
  runtimeHeartbeatKey
} from "../src/runtime/heartbeat.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("runtime heartbeat", () => {
  it("writes a bounded-lifetime ready record and deletes it on shutdown", async () => {
    const redis = {
      set: vi.fn().mockResolvedValue("OK"),
      del: vi.fn().mockResolvedValue(1)
    };
    const heartbeat = new RuntimeHeartbeat({
      service: "worker",
      redis,
      intervalMs: 10_000,
      ttlMs: 30_000,
      instanceId: "worker-a",
      probe: () => Promise.resolve(true),
      now: () => new Date("2026-01-02T03:04:05.000Z")
    });

    await heartbeat.start();
    expect(heartbeat.key).toBe(
      runtimeHeartbeatKey("worker", "worker-a")
    );
    expect(redis.set).toHaveBeenCalledWith(
      "skrynia:runtime:heartbeat:worker:worker-a",
      expect.stringContaining('"status":"ready"'),
      "PX",
      30_000
    );
    expect(heartbeat.isReady()).toBe(true);

    await heartbeat.stop();
    expect(redis.del).toHaveBeenCalledWith(heartbeat.key);
    expect(heartbeat.isReady()).toBe(false);
  });

  it("removes readiness when a dependency probe fails", async () => {
    const redis = {
      set: vi.fn().mockResolvedValue("OK"),
      del: vi.fn().mockResolvedValue(1)
    };
    const heartbeat = new RuntimeHeartbeat({
      service: "outbox",
      redis,
      intervalMs: 10_000,
      ttlMs: 30_000,
      instanceId: "outbox-a",
      probe: () => Promise.resolve(false)
    });

    await heartbeat.start();
    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.del).toHaveBeenCalledWith(heartbeat.key);
    expect(heartbeat.isReady()).toBe(false);
    await heartbeat.stop();
  });

  it("does not publish ready after shutdown starts during an in-flight probe", async () => {
    const probe = deferred<boolean>();
    const redis = {
      set: vi.fn().mockResolvedValue("OK"),
      del: vi.fn().mockResolvedValue(1)
    };
    const heartbeat = new RuntimeHeartbeat({
      service: "worker",
      redis,
      intervalMs: 10_000,
      ttlMs: 30_000,
      instanceId: "worker-stopping",
      probe: () => probe.promise
    });

    const starting = heartbeat.start();
    heartbeat.beginShutdown();
    probe.resolve(true);
    await starting;

    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.del).toHaveBeenCalledWith(heartbeat.key);
    expect(heartbeat.isReady()).toBe(false);
    await heartbeat.stop();
  });

  it("removes a beat whose Redis write completes after shutdown starts", async () => {
    const write = deferred<unknown>();
    const redis = {
      set: vi.fn(() => write.promise),
      del: vi.fn().mockResolvedValue(1)
    };
    const heartbeat = new RuntimeHeartbeat({
      service: "outbox",
      redis,
      intervalMs: 10_000,
      ttlMs: 30_000,
      instanceId: "outbox-stopping",
      probe: () => Promise.resolve(true)
    });

    const starting = heartbeat.start();
    await vi.waitFor(() => expect(redis.set).toHaveBeenCalledTimes(1));
    heartbeat.beginShutdown();
    write.resolve("OK");
    await starting;

    expect(redis.del).toHaveBeenCalledWith(heartbeat.key);
    expect(heartbeat.isReady()).toBe(false);
    await heartbeat.stop();
  });
});
