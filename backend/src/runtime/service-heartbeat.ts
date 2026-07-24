import type { QueryConfig } from "pg";
import { env } from "../config/env.js";
import { getRedis } from "../common/redis.js";
import { logger } from "../common/logger.js";
import { pool } from "../db/pool.js";
import { RuntimeHeartbeat } from "./heartbeat.js";
import { withTimeout } from "./async.js";

export function createServiceHeartbeat(
  service: "worker" | "outbox",
  isRuntimeReady: () => boolean
) {
  if (!env.REDIS_URL) throw new Error(`REDIS_URL is required by the ${service} runtime`);
  const redis = getRedis();
  if (!redis) throw new Error(`Redis is unavailable for the ${service} runtime`);

  return new RuntimeHeartbeat({
    service,
    redis,
    intervalMs: env.RUNTIME_HEARTBEAT_INTERVAL_MS,
    ttlMs: env.RUNTIME_HEARTBEAT_TTL_MS,
    instanceId: env.RUNTIME_INSTANCE_ID,
    probe: async () => {
      if (!isRuntimeReady()) return false;
      const query = {
        text: "select 1",
        query_timeout: env.HEALTHCHECK_TIMEOUT_MS
      } satisfies QueryConfig & { query_timeout: number };
      await withTimeout(
        pool.query(query),
        env.HEALTHCHECK_TIMEOUT_MS,
        "PostgreSQL heartbeat probe timed out"
      );
      return true;
    },
    onError: (error) => logger.warn({ error, service }, "runtime_heartbeat_failed")
  });
}
