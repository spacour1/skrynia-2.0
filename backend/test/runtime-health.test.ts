import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HealthService,
  ReadinessGate,
  mountHealthRoutes
} from "../src/runtime/health.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("runtime health", () => {
  it("keeps liveness independent from readiness dependencies", async () => {
    const gate = new ReadinessGate(false);
    const health = new HealthService({
      service: "api",
      gate,
      timeoutMs: 50,
      dependencies: [
        { name: "postgres", check: () => Promise.reject(new Error("db down")) }
      ],
      now: () => new Date("2026-01-02T03:04:05.000Z")
    });
    const app = express();
    mountHealthRoutes(app, health);

    const live = await request(app).get("/health/live");
    expect(live.status).toBe(200);
    expect(live.body).toEqual({
      status: "ok",
      service: "api",
      timestamp: "2026-01-02T03:04:05.000Z"
    });

    const ready = await request(app).get("/health/ready");
    expect(ready.status).toBe(503);
    expect(ready.body.checks).toEqual({ process: "unavailable" });
  });

  it("sanitizes dependency failures and reports every required check", async () => {
    const gate = new ReadinessGate(true);
    const health = new HealthService({
      service: "api",
      gate,
      timeoutMs: 50,
      dependencies: [
        {
          name: "postgres",
          check: () =>
            Promise.reject(
              new Error("postgres://admin:super-secret@internal-db:5432/app")
            )
        },
        { name: "redis", check: () => Promise.resolve() },
        { name: "realtime", check: () => Promise.resolve() }
      ]
    });

    const result = await health.readiness();
    expect(result.status).toBe("unavailable");
    expect(result.checks).toEqual({
      process: "ok",
      postgres: "unavailable",
      redis: "ok",
      realtime: "ok"
    });
    expect(JSON.stringify(result)).not.toContain("super-secret");
    expect(JSON.stringify(result)).not.toContain("internal-db");
  });

  it.each(["postgres", "redis"] as const)(
    "returns 503 when the required %s dependency fails",
    async (failedDependency) => {
      const gate = new ReadinessGate(true);
      const health = new HealthService({
        service: "api",
        gate,
        timeoutMs: 50,
        dependencies: ["postgres", "redis"].map((name) => ({
          name,
          check: () =>
            name === failedDependency
              ? Promise.reject(new Error(`${name} unavailable`))
              : Promise.resolve()
        }))
      });
      const app = express();
      mountHealthRoutes(app, health);

      const response = await request(app).get("/health/ready");
      expect(response.status).toBe(503);
      expect(response.body.checks[failedDependency]).toBe("unavailable");
    }
  );

  it("bounds and coalesces concurrent readiness probes", async () => {
    vi.useFakeTimers();
    const gate = new ReadinessGate(true);
    let calls = 0;
    const health = new HealthService({
      service: "api",
      gate,
      timeoutMs: 25,
      cacheTtlMs: 10,
      dependencies: [
        {
          name: "postgres",
          check: () => {
            calls += 1;
            return new Promise<void>(() => undefined);
          }
        }
      ]
    });

    const first = health.readiness();
    const second = health.readiness();
    expect(first).toBe(second);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(25);
    await expect(first).resolves.toMatchObject({
      status: "unavailable",
      checks: { postgres: "unavailable" }
    });
  });

  it("caches sequential probes for a short bounded interval", async () => {
    vi.useFakeTimers();
    const gate = new ReadinessGate(true);
    let calls = 0;
    const health = new HealthService({
      service: "api",
      gate,
      timeoutMs: 25,
      cacheTtlMs: 100,
      dependencies: [
        {
          name: "postgres",
          check: async () => {
            calls += 1;
          }
        }
      ]
    });

    await expect(health.readiness()).resolves.toMatchObject({ status: "ok" });
    await expect(health.readiness()).resolves.toMatchObject({ status: "ok" });
    expect(calls).toBe(1);

    await vi.advanceTimersByTimeAsync(101);
    await expect(health.readiness()).resolves.toMatchObject({ status: "ok" });
    expect(calls).toBe(2);
  });

  it("never starts a second underlying probe while a timed-out probe is unresolved", async () => {
    vi.useFakeTimers();
    const gate = new ReadinessGate(true);
    let calls = 0;
    let finishProbe!: () => void;
    const probe = new Promise<void>((resolve) => {
      finishProbe = resolve;
    });
    const health = new HealthService({
      service: "api",
      gate,
      timeoutMs: 25,
      cacheTtlMs: 10,
      dependencies: [
        {
          name: "postgres",
          check: () => {
            calls += 1;
            return probe;
          }
        }
      ]
    });

    const first = health.readiness();
    await vi.advanceTimersByTimeAsync(25);
    await expect(first).resolves.toMatchObject({ status: "unavailable" });
    expect(calls).toBe(1);

    await vi.advanceTimersByTimeAsync(11);
    const retry = health.readiness();
    await vi.advanceTimersByTimeAsync(25);
    await expect(retry).resolves.toMatchObject({ status: "unavailable" });
    expect(calls).toBe(1);

    finishProbe();
    await vi.runAllTimersAsync();
  });

  it("cannot become ready after shutdown begins during a dependency probe", async () => {
    let finishCheck!: () => void;
    const check = new Promise<void>((resolve) => {
      finishCheck = resolve;
    });
    const gate = new ReadinessGate(true);
    const health = new HealthService({
      service: "api",
      gate,
      timeoutMs: 100,
      dependencies: [{ name: "postgres", check: () => check }]
    });

    const pending = health.readiness();
    gate.markNotReady();
    finishCheck();

    await expect(pending).resolves.toMatchObject({
      status: "unavailable",
      checks: { process: "unavailable", postgres: "ok" }
    });
  });
});
