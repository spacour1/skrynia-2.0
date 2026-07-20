import { randomUUID } from "node:crypto";
import os from "node:os";
import { env } from "../../config/env.js";
import { getRedis } from "../../common/redis.js";
import {
  RealtimeEventBus,
  type RealtimeEventHandler
} from "./realtime-event-bus.service.js";
import { PresenceService } from "./presence.service.js";

const instanceId =
  env.REALTIME_INSTANCE_ID ??
  `${os.hostname()}:${process.pid}:${randomUUID()}`;
const redis = getRedis();

const eventBus = new RealtimeEventBus({
  publisher: redis,
  instanceId,
  channel: env.REALTIME_CHANNEL
});

const presence = new PresenceService({
  redis,
  instanceId,
  ttlMs: env.PRESENCE_TTL_MS,
  heartbeatMs: env.PRESENCE_HEARTBEAT_MS
});

export function onRealtimeEvent(handler: RealtimeEventHandler) {
  return eventBus.onEvent(handler);
}

export function publishRealtimeEvent(
  input: Parameters<RealtimeEventBus["publish"]>[0],
  options?: Parameters<RealtimeEventBus["publish"]>[1]
) {
  return eventBus.publish(input, options);
}

export function getPresenceService() {
  return presence;
}

export async function startRealtimeServices() {
  presence.start();
  await eventBus.start();
}

export async function stopRealtimeServices() {
  await presence.stop();
  await eventBus.stop();
}

export function getRealtimeReadiness() {
  const status = eventBus.getStatus();
  const redisState = redis?.status ?? "unconfigured";
  const ok =
    status.configured &&
    status.started &&
    status.subscriberReady &&
    status.publisherReady &&
    redisState === "ready";
  return {
    ok,
    status: ok ? "ready" : "degraded",
    redis: redisState,
    subscriber: status.subscriberReady ? "ready" : "degraded",
    presence: redisState === "ready" ? "available" : "unknown",
    instanceId,
    lastError: status.lastError
  };
}
