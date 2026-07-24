import { afterEach, describe, expect, it, vi } from "vitest";
import {
  drainAndCloseBullWorker,
  drainStartingBullWorker
} from "../src/runtime/bull-worker-drain.js";

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

describe("BullMQ worker drain", () => {
  it("pauses new jobs and waits for active work before closing", async () => {
    const active = deferred();
    const worker = {
      pause: vi.fn(() => active.promise),
      close: vi.fn().mockResolvedValue(undefined)
    };

    const draining = drainAndCloseBullWorker(worker, 1_000);
    expect(worker.pause).toHaveBeenCalledWith(false);
    expect(worker.close).not.toHaveBeenCalled();
    active.resolve();

    await expect(draining).resolves.toEqual({ drained: true, forced: false });
    expect(worker.close).toHaveBeenCalledWith(false);
  });

  it("forces the worker closed after the bounded grace period", async () => {
    vi.useFakeTimers();
    const worker = {
      pause: vi.fn(() => new Promise<void>(() => undefined)),
      close: vi.fn().mockResolvedValue(undefined)
    };

    const draining = drainAndCloseBullWorker(worker, 100);
    await vi.advanceTimersByTimeAsync(100);

    await expect(draining).resolves.toEqual({ drained: false, forced: true });
    expect(worker.close).toHaveBeenCalledWith(true);
  });

  it("closes a partially-started worker before waiting for startup to settle", async () => {
    const startup = deferred();
    const events: string[] = [];
    const worker = {
      pause: vi.fn(async () => {
        events.push("pause");
      }),
      close: vi.fn(async () => {
        events.push("close");
      })
    };

    let completed = false;
    const stopping = drainStartingBullWorker(
      worker,
      startup.promise,
      1_000
    ).then(() => {
      completed = true;
    });
    await vi.waitFor(() => expect(worker.close).toHaveBeenCalledOnce());

    expect(events).toEqual(["pause", "close"]);
    expect(completed).toBe(false);
    startup.resolve();
    await stopping;
    expect(completed).toBe(true);
  });
});
