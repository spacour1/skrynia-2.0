import type { QueryConfig } from "pg";
import { env } from "../config/env.js";
import { getRedis } from "../common/redis.js";
import { pool } from "../db/pool.js";
import { getRealtimeReadiness } from "../modules/realtime/realtime-runtime.js";
import { HealthService, ReadinessGate } from "./health.js";

export function createApiHealthService(gate: ReadinessGate) {
  return new HealthService({
    service: "api",
    gate,
    timeoutMs: env.HEALTHCHECK_TIMEOUT_MS,
    dependencies: [
      {
        name: "postgres",
        check: async () => {
          // node-postgres supports per-query `query_timeout` at runtime, although
          // the current @types/pg QueryConfig omits that documented field.
          const query = {
            text: "select 1",
            // The HealthService wrapper returns promptly, while this driver bound
            // prevents an abandoned probe from occupying the pool indefinitely.
            query_timeout: env.HEALTHCHECK_TIMEOUT_MS
          } satisfies QueryConfig & { query_timeout: number };
          await pool.query(query);
        }
      },
      {
        name: "redis",
        check: async () => {
          if (!env.REDIS_URL) throw new Error("Required Redis is not configured");
          const redis = getRedis();
          if (!redis) throw new Error("Required Redis is unavailable");
          await redis.ping();
        }
      },
      {
        name: "realtime",
        check: async () => {
          if (!getRealtimeReadiness().ok) {
            throw new Error("Realtime subscriber is not ready");
          }
        }
      }
    ]
  });
}
