import { describe, expect, it, vi } from "vitest";
import { checkRuntimeHeartbeat } from "../src/runtime/heartbeat-healthcheck.js";

const NOW = Date.parse("2026-07-24T12:00:00.000Z");

function fakeRedis(options: {
  value: string | null;
  remainingTtlMs?: number;
}) {
  const events: string[] = [];
  return {
    events,
    client: {
      connect: vi.fn(async () => {
        events.push("connect");
      }),
      get: vi.fn(async () => {
        events.push("get");
        return options.value;
      }),
      pttl: vi.fn(async () => {
        events.push("pttl");
        return options.remainingTtlMs ?? 20_000;
      }),
      disconnect: vi.fn(() => {
        events.push("disconnect");
      })
    }
  };
}

function readyValue(timestamp = new Date(NOW).toISOString()) {
  return JSON.stringify({
    status: "ready",
    service: "worker",
    pid: 42,
    timestamp
  });
}

describe("runtime heartbeat healthcheck", () => {
  it("connects before reading a live expiring heartbeat", async () => {
    const redis = fakeRedis({ value: readyValue() });

    await expect(
      checkRuntimeHeartbeat({
        service: "worker",
        instanceId: "worker-a",
        timeoutMs: 100,
        ttlMs: 30_000,
        redis: redis.client,
        now: () => NOW
      })
    ).resolves.toBeUndefined();

    expect(redis.events[0]).toBe("connect");
    expect(redis.events.at(-1)).toBe("disconnect");
  });

  it("fails closed when the expected heartbeat key is missing", async () => {
    const redis = fakeRedis({ value: null, remainingTtlMs: -2 });

    await expect(
      checkRuntimeHeartbeat({
        service: "worker",
        instanceId: "missing",
        timeoutMs: 100,
        ttlMs: 30_000,
        redis: redis.client,
        now: () => NOW
      })
    ).rejects.toThrow("Heartbeat is absent");
    expect(redis.client.disconnect).toHaveBeenCalledOnce();
  });

  it("rejects an old ready payload even if its key still has a TTL", async () => {
    const redis = fakeRedis({
      value: readyValue(new Date(NOW - 30_001).toISOString())
    });

    await expect(
      checkRuntimeHeartbeat({
        service: "worker",
        instanceId: "stale",
        timeoutMs: 100,
        ttlMs: 30_000,
        redis: redis.client,
        now: () => NOW
      })
    ).rejects.toThrow("Heartbeat is stale");
    expect(redis.client.disconnect).toHaveBeenCalledOnce();
  });
});
