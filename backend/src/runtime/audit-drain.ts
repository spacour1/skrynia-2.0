import { logger } from "../common/logger.js";
import { drainPendingAuditWrites } from "../common/middleware/request-context.js";
import { RuntimeTimeoutError, withTimeout } from "./async.js";

export const AUDIT_DRAIN_TIMEOUT_MS = 5_000;

export type AuditDrainLogger = Pick<typeof logger, "warn">;

export async function drainAuditWritesForShutdown(
  options: {
    drain?: () => Promise<boolean>;
    timeoutMs?: number;
    shutdownLogger?: AuditDrainLogger;
  } = {}
) {
  const drain = options.drain ?? drainPendingAuditWrites;
  const timeoutMs = options.timeoutMs ?? AUDIT_DRAIN_TIMEOUT_MS;
  const shutdownLogger = options.shutdownLogger ?? logger;

  if (timeoutMs <= 0) {
    shutdownLogger.warn({ timeoutMs: 0 }, "audit_drain_timeout");
    return false;
  }

  try {
    const successful = await withTimeout(
      Promise.resolve().then(drain),
      timeoutMs,
      `Pending audit writes exceeded the ${timeoutMs}ms shutdown deadline`
    );
    if (!successful) {
      shutdownLogger.warn({}, "audit_drain_incomplete");
    }
    return successful;
  } catch (error) {
    if (error instanceof RuntimeTimeoutError) {
      shutdownLogger.warn({ timeoutMs }, "audit_drain_timeout");
    } else {
      // Do not attach the error: database/provider errors may contain sensitive
      // context. Per-write failures are already logged by the request logger.
      shutdownLogger.warn({}, "audit_drain_failed");
    }
    return false;
  }
}
