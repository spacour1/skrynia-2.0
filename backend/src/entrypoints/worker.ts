import * as Sentry from "@sentry/node";
import { env } from "../config/env.js";
import { logger } from "../common/logger.js";
import { closeRedis } from "../common/redis.js";
import { closeDbPool } from "../db/pool.js";
import {
  closeJobQueue,
  getJobWorkerReadiness,
  startJobWorker,
  stopJobWorker
} from "../modules/jobs/queue.js";
import { initializeRuntimeProcess } from "../runtime/process-bootstrap.js";
import { installProcessLifecycle } from "../runtime/process-lifecycle.js";
import { createServiceHeartbeat } from "../runtime/service-heartbeat.js";
import { runCleanupSteps } from "../runtime/async.js";

export async function startWorkerRuntime() {
  initializeRuntimeProcess();
  let heartbeat: ReturnType<typeof createServiceHeartbeat> | null = null;
  let shutdownRequested = false;
  let cleanupPromise: Promise<void> | null = null;
  let shutdownPromise: Promise<void> | null = null;

  const cleanup = () => {
    cleanupPromise ??= runCleanupSteps([
      {
        name: "job worker",
        run: () => stopJobWorker(env.SHUTDOWN_GRACE_MS)
      },
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

  // Redis may disappear after the orchestrator dependency check and leave BullMQ
  // startup pending. Signals must already own the partially-created worker then.
  const lifecycle = installProcessLifecycle({
    hardTimeoutMs: env.SHUTDOWN_HARD_TIMEOUT_MS,
    markNotReady: () => {
      shutdownRequested = true;
      heartbeat?.beginShutdown();
      void heartbeat?.markNotReady();
    },
    shutdown,
    forceClose: () => {
      void stopJobWorker(1);
    },
    logger
  });

  try {
    await startJobWorker();
    if (shutdownRequested) {
      await shutdown();
      return { heartbeat, lifecycle, shutdown };
    }

    heartbeat = createServiceHeartbeat("worker", getJobWorkerReadiness);
    await heartbeat.start();
    if (shutdownRequested) await shutdown();
  } catch (error) {
    if (shutdownRequested) {
      await shutdown();
      return { heartbeat, lifecycle, shutdown };
    }
    await cleanup().catch((cleanupError) => {
      logger.error({ error: cleanupError }, "job_worker_start_cleanup_failed");
    });
    lifecycle.dispose();
    throw error;
  }

  return { heartbeat, lifecycle, shutdown };
}

void startWorkerRuntime().catch((error) => {
  logger.fatal({ error }, "job_worker_start_failed");
  process.exitCode = 1;
});
