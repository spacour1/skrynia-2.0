import {
  AUDIT_DRAIN_TIMEOUT_MS,
  drainAuditWritesForShutdown,
  type AuditDrainLogger
} from "./audit-drain.js";
import { onceAsync, runCleanupSteps } from "./async.js";

export const ERROR_TRACKING_DRAIN_TIMEOUT_MS = 2_000;
export const POST_AUDIT_SHUTDOWN_RESERVE_MS =
  ERROR_TRACKING_DRAIN_TIMEOUT_MS + 250;

type CleanupOperation = () => Promise<unknown> | unknown;

export function auditDrainTimeoutBeforeDeadline(
  hardDeadlineAt: number,
  now = Date.now()
) {
  return Math.max(
    0,
    Math.min(
      AUDIT_DRAIN_TIMEOUT_MS,
      hardDeadlineAt - now - POST_AUDIT_SHUTDOWN_RESERVE_MS
    )
  );
}

/** Builds the production cleanup order and memoizes it for repeated shutdown calls. */
export function createApiCleanup(options: {
  stopRealtime: CleanupOperation;
  closeJobQueue: CleanupOperation;
  closeRedis: CleanupOperation;
  closeDatabase: CleanupOperation;
  closeErrorTracking: CleanupOperation;
  drainAuditWrites?: () => Promise<boolean>;
  shutdownLogger?: AuditDrainLogger;
}) {
  return onceAsync((hardDeadlineAt: number) =>
    runCleanupSteps([
      { name: "realtime", run: options.stopRealtime },
      { name: "job queue", run: options.closeJobQueue },
      { name: "redis", run: options.closeRedis },
      {
        name: "pending audit writes",
        run: () =>
          drainAuditWritesForShutdown({
            drain: options.drainAuditWrites,
            timeoutMs: auditDrainTimeoutBeforeDeadline(hardDeadlineAt),
            shutdownLogger: options.shutdownLogger
          })
      },
      { name: "postgres", run: options.closeDatabase },
      { name: "error tracking", run: options.closeErrorTracking }
    ])
  );
}
