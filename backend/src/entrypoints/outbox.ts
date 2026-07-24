import * as Sentry from "@sentry/node";
import { env } from "../config/env.js";
import { logger } from "../common/logger.js";
import { closeRedis } from "../common/redis.js";
import { closeDbPool } from "../db/pool.js";
import { closeJobQueue } from "../modules/jobs/queue.js";
import {
  getOutboxWorkerReadiness,
  startOutboxWorker,
  stopOutboxWorker
} from "../modules/outbox/outbox.worker.js";
import { initializeRuntimeProcess } from "../runtime/process-bootstrap.js";
import { installProcessLifecycle } from "../runtime/process-lifecycle.js";
import { createServiceHeartbeat } from "../runtime/service-heartbeat.js";
import { runCleanupSteps } from "../runtime/async.js";

export async function startOutboxRuntime() {
  initializeRuntimeProcess();
  let heartbeat: ReturnType<typeof createServiceHeartbeat> | null = null;
  let shutdownRequested = false;
  let cleanupPromise: Promise<void> | null = null;
  let shutdownPromise: Promise<void> | null = null;

  const cleanup = () => {
    cleanupPromise ??= runCleanupSteps([
      { name: "outbox poller", run: stopOutboxWorker },
      { name: "job queue", run: closeJobQueue },
      {
        name: "heartbeat",
        run: () => heartbeat?.stop() ?? Promise.resolve()
      },
      { name: "redis", run: closeRedis },
      { name: "postgres", run: closeDbPool },
      { name: "error tracking", run: () => Sentry.close(2_000) }
    ]);
    return cleanupPromise;
  };

  const shutdown = async () => {
    shutdownRequested = true;
    heartbeat?.beginShutdown();
    shutdownPromise ??= cleanup();
    return shutdownPromise;
  };

  // Install lifecycle ownership before the first database poll. A backlog must not
  // postpone SIGTERM handling or heartbeat setup.
  const lifecycle = installProcessLifecycle({
    hardTimeoutMs: env.SHUTDOWN_HARD_TIMEOUT_MS,
    markNotReady: () => {
      shutdownRequested = true;
      heartbeat?.beginShutdown();
      void heartbeat?.markNotReady();
    },
    shutdown,
    // A forced exit deliberately leaves an in-flight claim in `processing`; stale
    // claim recovery is safer than replaying a side effect that may have completed.
    forceClose: () => undefined,
    logger
  });

  try {
    await startOutboxWorker();
    if (shutdownRequested) {
      await shutdown();
      return { heartbeat, lifecycle, shutdown };
    }

    heartbeat = createServiceHeartbeat("outbox", getOutboxWorkerReadiness);
    await heartbeat.start();
    if (shutdownRequested) await shutdown();
  } catch (error) {
    if (shutdownRequested) {
      await shutdown();
      return { heartbeat, lifecycle, shutdown };
    }
    await cleanup().catch((cleanupError) => {
      logger.error({ error: cleanupError }, "outbox_worker_start_cleanup_failed");
    });
    lifecycle.dispose();
    throw error;
  }

  return { heartbeat, lifecycle, shutdown };
}

void startOutboxRuntime().catch((error) => {
  logger.fatal({ error }, "outbox_worker_start_failed");
  process.exitCode = 1;
});
