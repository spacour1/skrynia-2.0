import http from "node:http";
import * as Sentry from "@sentry/node";
import { env } from "../config/env.js";
import { createApp } from "../app.js";
import { closeRedis } from "../common/redis.js";
import { logger } from "../common/logger.js";
import { closeDbPool } from "../db/pool.js";
import {
  attachWebSocketServer,
  type WebSocketRuntime
} from "../modules/chat/ws.service.js";
import { closeJobQueue } from "../modules/jobs/queue.js";
import {
  startRealtimeServices,
  stopRealtimeServices
} from "../modules/realtime/realtime-runtime.js";
import { createApiHealthService } from "../runtime/api-health.js";
import { runCleanupSteps, settleWithin } from "../runtime/async.js";
import { ReadinessGate } from "../runtime/health.js";
import { initializeRuntimeProcess } from "../runtime/process-bootstrap.js";
import { installProcessLifecycle } from "../runtime/process-lifecycle.js";

function listen(server: http.Server) {
  return new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(env.PORT, "0.0.0.0", () => {
      server.off("error", onError);
      resolve();
    });
  });
}

function beginHttpShutdown(server: http.Server) {
  const closed = new Promise<void>((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
  server.closeIdleConnections?.();
  return closed;
}

export async function startApiRuntime() {
  initializeRuntimeProcess();
  const readiness = new ReadinessGate();
  const app = createApp({ healthService: createApiHealthService(readiness) });
  const server = http.createServer(app);
  let websocket: WebSocketRuntime | null = null;
  let shutdownRequested = false;
  let cleanupPromise: Promise<void> | null = null;
  let shutdownPromise: Promise<void> | null = null;

  const cleanup = () => {
    cleanupPromise ??= runCleanupSteps([
      { name: "realtime", run: stopRealtimeServices },
      { name: "job queue", run: closeJobQueue },
      { name: "redis", run: closeRedis },
      { name: "postgres", run: closeDbPool },
      { name: "error tracking", run: () => Sentry.close(2_000) }
    ]);
    return cleanupPromise;
  };

  const forceClose = () => {
    readiness.markNotReady();
    websocket?.forceClose();
    server.closeAllConnections?.();
  };

  const shutdown = async () => {
    shutdownRequested = true;
    readiness.markNotReady();
    if (!shutdownPromise) {
      shutdownPromise = (async () => {
        const httpClosed = beginHttpShutdown(server);
        const websocketClosed =
          websocket?.beginShutdown() ?? Promise.resolve();
        const drained = await settleWithin(
          Promise.all([httpClosed, websocketClosed]),
          env.SHUTDOWN_GRACE_MS
        );
        if (!drained) forceClose();
        await cleanup();
      })();
    }
    return shutdownPromise;
  };

  // Install signal/error policy before Redis, WebSocket, or listen startup. A
  // deployment can be terminated while any of those operations is still pending.
  const lifecycle = installProcessLifecycle({
    hardTimeoutMs: env.SHUTDOWN_HARD_TIMEOUT_MS,
    markNotReady: () => {
      shutdownRequested = true;
      readiness.markNotReady();
    },
    shutdown,
    forceClose,
    logger
  });

  try {
    await startRealtimeServices();
    if (shutdownRequested) {
      await shutdown();
      return { app, server, websocket, readiness, lifecycle, shutdown };
    }

    websocket = attachWebSocketServer(server);
    await listen(server);
    if (shutdownRequested) {
      await shutdown();
      return { app, server, websocket, readiness, lifecycle, shutdown };
    }

    readiness.markReady();
    logger.info({ port: env.PORT }, "api_listening");
  } catch (error) {
    if (shutdownRequested) {
      await shutdown();
      return { app, server, websocket, readiness, lifecycle, shutdown };
    }
    readiness.markNotReady();
    forceClose();
    await beginHttpShutdown(server);
    await cleanup().catch((cleanupError) => {
      logger.error({ error: cleanupError }, "api_start_cleanup_failed");
    });
    lifecycle.dispose();
    throw error;
  }

  return { app, server, websocket, readiness, lifecycle, shutdown };
}

void startApiRuntime().catch((error) => {
  logger.fatal({ error }, "api_start_failed");
  process.exitCode = 1;
});
