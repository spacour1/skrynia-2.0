import { afterEach, describe, expect, it, vi } from "vitest";
import { BackgroundPoller } from "../src/runtime/background-poller.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("BackgroundPoller", () => {
  it("does not make process startup wait for an unbounded initial backlog", async () => {
    const iteration = deferred();
    const task = vi.fn(() => iteration.promise);
    const poller = new BackgroundPoller({ intervalMs: 1_000, task });

    // The old implementation awaited this iteration. An outbox that kept returning a
    // full batch could therefore prevent heartbeat and signal setup forever.
    await expect(poller.start()).resolves.toBeUndefined();
    expect(task).toHaveBeenCalledTimes(1);

    let stopped = false;
    const stopping = poller.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);

    iteration.resolve();
    await stopping;
    expect(stopped).toBe(true);
  });

  it("stops scheduling and waits for the current iteration", async () => {
    vi.useFakeTimers();
    const iteration = deferred();
    const task = vi.fn(() => iteration.promise);
    const poller = new BackgroundPoller({ intervalMs: 50, task });

    const started = poller.start();
    expect(task).toHaveBeenCalledTimes(1);
    let stopped = false;
    const stopping = poller.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);

    iteration.resolve();
    await Promise.all([started, stopping]);
    await vi.advanceTimersByTimeAsync(500);
    expect(task).toHaveBeenCalledTimes(1);
    expect(stopped).toBe(true);
  });

  it("coalesces overlapping triggers", async () => {
    const iteration = deferred();
    const task = vi.fn(() => iteration.promise);
    const poller = new BackgroundPoller({ intervalMs: 1_000, task });

    const first = poller.trigger();
    const second = poller.trigger();
    expect(first).toBe(second);
    expect(task).toHaveBeenCalledTimes(1);
    iteration.resolve();
    await first;
    await poller.stop();
  });
});
