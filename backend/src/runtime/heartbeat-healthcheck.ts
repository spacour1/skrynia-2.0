import os from "node:os";
import { pathToFileURL } from "node:url";
import { Redis } from "ioredis";
import { withTimeout } from "./async.js";
import { runtimeHeartbeatKey } from "./heartbeat.js";

type HeartbeatService = "worker" | "outbox";

type HeartbeatCheckRedis = {
  connect(): Promise<unknown>;
  get(key: string): Promise<string | null>;
  pttl(key: string): Promise<number>;
  disconnect(): void;
};

function readBoundedInteger(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number
) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} is outside the supported range`);
  }
  return value;
}

export async function checkRuntimeHeartbeat(options: {
  service: HeartbeatService;
  instanceId: string;
  timeoutMs: number;
  ttlMs: number;
  redis: HeartbeatCheckRedis;
  now?: () => number;
}) {
  const { redis } = options;
  try {
    // With the offline queue disabled, issuing GET before ioredis reaches `ready`
    // fails even when Redis is healthy. Connect explicitly and bound both phases.
    await withTimeout(
      redis.connect(),
      options.timeoutMs,
      "Heartbeat Redis connection timed out"
    );
    const key = runtimeHeartbeatKey(options.service, options.instanceId);
    const [raw, remainingTtlMs] = await withTimeout(
      Promise.all([redis.get(key), redis.pttl(key)]),
      options.timeoutMs,
      "Heartbeat check timed out"
    );
    if (!raw || remainingTtlMs <= 0) throw new Error("Heartbeat is absent");

    const heartbeat = JSON.parse(raw) as {
      status?: unknown;
      service?: unknown;
      timestamp?: unknown;
    };
    if (
      heartbeat.status !== "ready" ||
      heartbeat.service !== options.service ||
      typeof heartbeat.timestamp !== "string"
    ) {
      throw new Error("Heartbeat is not ready");
    }

    const heartbeatAt = Date.parse(heartbeat.timestamp);
    const ageMs = (options.now?.() ?? Date.now()) - heartbeatAt;
    if (!Number.isFinite(heartbeatAt) || ageMs < 0 || ageMs > options.ttlMs) {
      throw new Error("Heartbeat is stale");
    }
  } finally {
    redis.disconnect();
  }
}

async function main() {
  const candidate = process.argv[2];
  if (candidate !== "worker" && candidate !== "outbox") {
    throw new Error("Expected heartbeat service: worker or outbox");
  }
  const redisUrl = process.env.REDIS_URL?.trim();
  if (!redisUrl) throw new Error("REDIS_URL is required");
  const timeoutMs = readBoundedInteger(
    "HEALTHCHECK_TIMEOUT_MS",
    1_000,
    100,
    10_000
  );
  const ttlMs = readBoundedInteger(
    "RUNTIME_HEARTBEAT_TTL_MS",
    30_000,
    3_000,
    86_400_000
  );

  const redis = new Redis(redisUrl, {
    connectTimeout: timeoutMs,
    enableOfflineQueue: false,
    lazyConnect: true,
    maxRetriesPerRequest: 0
  });
  // A failed probe is represented only by its exit code. Do not print Redis errors:
  // they can contain deployment-internal hostnames or addresses.
  redis.on("error", () => undefined);
  await checkRuntimeHeartbeat({
    service: candidate,
    instanceId: process.env.RUNTIME_INSTANCE_ID?.trim() || os.hostname(),
    timeoutMs,
    ttlMs,
    redis
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch(() => {
    process.exitCode = 1;
  });
}
