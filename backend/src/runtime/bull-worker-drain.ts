import { settleWithin } from "./async.js";

export type DrainableBullWorker = {
  pause(doNotWaitActive?: boolean): Promise<void>;
  close(force?: boolean): Promise<void>;
};

export async function drainAndCloseBullWorker(
  worker: DrainableBullWorker,
  graceMs: number,
  onPauseError?: (error: unknown) => void
) {
  let pauseFailed = false;
  const drained = await settleWithin(
    worker.pause(false).catch((error) => {
      pauseFailed = true;
      onPauseError?.(error);
    }),
    graceMs
  );
  const forced = !drained || pauseFailed;
  await worker.close(forced);
  return { drained: !forced, forced };
}

export async function drainStartingBullWorker(
  worker: DrainableBullWorker,
  startup: Promise<unknown> | null,
  graceMs: number,
  onPauseError?: (error: unknown) => void
) {
  const result = await drainAndCloseBullWorker(
    worker,
    graceMs,
    onPauseError
  );
  // Closing the worker makes a pending waitUntilReady() settle. Crucially, close
  // happens first; waiting for startup first deadlocks shutdown when Redis is down.
  await startup?.catch(() => undefined);
  return result;
}
