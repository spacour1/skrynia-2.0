import { afterEach, describe, expect, it, vi } from "vitest";
import { ProcessLifecycleController } from "../src/runtime/process-lifecycle.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function logger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn()
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("process lifecycle", () => {
  it("marks not-ready before cleanup and completes without forced exit", async () => {
    const order: string[] = [];
    const setExitCode = vi.fn();
    const forceExit = vi.fn();
    const controller = new ProcessLifecycleController({
      hardTimeoutMs: 1_000,
      markNotReady: () => order.push("not-ready"),
      shutdown: async () => {
        order.push("shutdown");
      },
      forceClose: () => order.push("force"),
      forceExit,
      setExitCode,
      logger: logger()
    });

    await controller.request("SIGTERM", 0, 143);
    expect(order).toEqual(["not-ready", "shutdown"]);
    expect(setExitCode).toHaveBeenCalledWith(0);
    expect(forceExit).not.toHaveBeenCalled();
  });

  it("forces an in-progress shutdown on the second signal", async () => {
    const cleanup = deferred();
    const forceClose = vi.fn();
    const forceExit = vi.fn();
    const controller = new ProcessLifecycleController({
      hardTimeoutMs: 1_000,
      markNotReady: vi.fn(),
      shutdown: () => cleanup.promise,
      forceClose,
      forceExit,
      setExitCode: vi.fn(),
      logger: logger()
    });

    const first = controller.request("SIGTERM", 0, 143);
    controller.request("SIGTERM", 0, 143);
    expect(forceClose).toHaveBeenCalledTimes(1);
    expect(forceExit).toHaveBeenCalledWith(143);
    cleanup.resolve();
    await first;
  });

  it("forces exit when the hard shutdown deadline expires", async () => {
    vi.useFakeTimers();
    const cleanup = deferred();
    const forceExit = vi.fn();
    const controller = new ProcessLifecycleController({
      hardTimeoutMs: 100,
      markNotReady: vi.fn(),
      shutdown: () => cleanup.promise,
      forceClose: vi.fn(),
      forceExit,
      setExitCode: vi.fn(),
      logger: logger()
    });

    const pending = controller.request("uncaughtException", 1, 1);
    await vi.advanceTimersByTimeAsync(100);
    expect(forceExit).toHaveBeenCalledWith(1);
    cleanup.resolve();
    await pending;
  });

  it("continues shutdown when marking readiness fails", async () => {
    const shutdown = vi.fn().mockResolvedValue(undefined);
    const lifecycleLogger = logger();
    const controller = new ProcessLifecycleController({
      hardTimeoutMs: 1_000,
      markNotReady: () => {
        throw new Error("readiness backend unavailable");
      },
      shutdown,
      forceClose: vi.fn(),
      forceExit: vi.fn(),
      setExitCode: vi.fn(),
      logger: lifecycleLogger
    });

    await controller.request("SIGTERM", 0, 143);
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(lifecycleLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "SIGTERM" }),
      "runtime_mark_not_ready_failed"
    );
  });
});
