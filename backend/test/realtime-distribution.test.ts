import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "../src/config/env.js";
import { PresenceService } from "../src/modules/realtime/presence.service.js";
import {
  RealtimeEventBus,
  type RealtimeEvent
} from "../src/modules/realtime/realtime-event-bus.service.js";

const channel = `test:realtime:${randomUUID()}`;
let redisA: Redis;
let redisB: Redis;
let busA: RealtimeEventBus;
let busB: RealtimeEventBus;
const busBSubscriberStates: boolean[] = [];

async function waitForCondition(
  predicate: () => boolean,
  message: string,
  timeoutMs = 4_000
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(message);
}

function findClientId(clientList: string, connectionName: string) {
  for (const line of clientList.split("\n")) {
    const fields = line.trim().split(/\s+/);
    if (!fields.includes(`name=${connectionName}`)) continue;
    const id = fields.find((field) => field.startsWith("id="))?.slice(3);
    if (id && /^\d+$/.test(id)) return id;
  }
  return null;
}

function waitForEvent(
  bus: RealtimeEventBus,
  predicate: (event: RealtimeEvent) => boolean
) {
  return new Promise<RealtimeEvent>((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error("Timed out waiting for realtime event"));
    }, 2_000);
    const unsubscribe = bus.onEvent((event) => {
      if (!predicate(event)) return;
      clearTimeout(timeout);
      unsubscribe();
      resolve(event);
    });
  });
}

beforeAll(async () => {
  if (!env.REDIS_URL) throw new Error("Realtime tests require REDIS_URL");
  redisA = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1
  });
  redisB = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1
  });
  busA = new RealtimeEventBus({
    publisher: redisA,
    instanceId: "realtime-test-a",
    channel
  });
  busB = new RealtimeEventBus({
    publisher: redisB,
    instanceId: "realtime-test-b",
    channel,
    onStatusChange: () => {
      busBSubscriberStates.push(busB.getStatus().subscriberReady);
    }
  });
  await Promise.all([busA.start(), busB.start()]);
});

afterAll(async () => {
  await Promise.all([busA.stop(), busB.stop()]);
  await Promise.all([
    redisA.status === "end" ? undefined : redisA.quit(),
    redisB.status === "end" ? undefined : redisB.quit()
  ]);
});

describe("distributed realtime", () => {
  it("delivers a user event from replica A to a client on replica B", async () => {
    const userId = randomUUID();
    const observer = redisA.duplicate({
      lazyConnect: true,
      maxRetriesPerRequest: 1
    });
    let channelDeliveries = 0;
    observer.on("message", () => {
      channelDeliveries += 1;
    });
    await observer.subscribe(channel);
    const received = waitForEvent(
      busB,
      (event) => event.scope === "user" && event.targetId === userId
    );

    const published = await busA.publish({
      type: "order_started",
      scope: "user",
      targetId: userId,
      payload: { type: "order_started", orderId: randomUUID() }
    });

    expect(published.published).toBe(true);
    const event = await received;
    expect(event.sourceInstanceId).toBe("realtime-test-a");
    expect(event.payload).toMatchObject({ type: "order_started" });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(channelDeliveries).toBe(1);
    await observer.quit();
  });

  it("closes the simulated remote socket on a ban and ignores malformed events", async () => {
    const userId = randomUUID();
    let socketOpen = true;
    let deliveries = 0;
    const unsubscribe = busB.onEvent((event) => {
      deliveries += 1;
      if (
        event.type === "user.banned" &&
        event.scope === "user" &&
        event.targetId === userId
      ) {
        socketOpen = false;
      }
    });

    await busA.publish({
      type: "user.banned",
      scope: "user",
      targetId: userId,
      payload: {}
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(socketOpen).toBe(false);
    const validDeliveries = deliveries;

    await redisA.publish(channel, "{not-json");
    await redisA.publish(
      channel,
      JSON.stringify({ type: "missing-envelope-fields" })
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(deliveries).toBe(validDeliveries);
    unsubscribe();
  });

  it("suppresses a duplicate remote envelope before its first dispatch finishes", async () => {
    const eventId = randomUUID();
    let deliveries = 0;
    let releaseFirstDispatch: () => void = () => undefined;
    const firstDispatchReleased = new Promise<void>((resolve) => {
      releaseFirstDispatch = resolve;
    });
    const unsubscribe = busB.onEvent(async (event) => {
      if (event.id !== eventId) return;
      deliveries += 1;
      await firstDispatchReleased;
    });
    const envelope: RealtimeEvent = {
      id: eventId,
      type: "duplicate_probe",
      scope: "user",
      targetId: randomUUID(),
      payload: { type: "duplicate_probe" },
      sourceInstanceId: `remote-${randomUUID()}`,
      createdAt: new Date().toISOString()
    };

    try {
      await redisA.publish(channel, JSON.stringify(envelope));
      await waitForCondition(
        () => deliveries === 1,
        "First duplicate probe was not dispatched"
      );
      await redisA.publish(channel, JSON.stringify(envelope));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(deliveries).toBe(1);
    } finally {
      releaseFirstDispatch();
      unsubscribe();
    }
  });

  it("reconnects and resubscribes after the real Redis subscriber is disconnected", async () => {
    const connectionName = busB.getSubscriberConnectionName();
    expect(connectionName).toMatch(/^keepgame-realtime-sub-[a-f0-9]{24}$/);
    expect(connectionName).not.toContain("realtime-test-b");

    const clientList = String(await redisA.call("CLIENT", "LIST"));
    const subscriberClientId = findClientId(clientList, connectionName);
    expect(subscriberClientId).not.toBeNull();
    const transitionStart = busBSubscriberStates.length;

    await redisA.call("CLIENT", "KILL", "ID", subscriberClientId!);
    await waitForCondition(
      () => busBSubscriberStates.slice(transitionStart).includes(false),
      "Subscriber did not report the Redis disconnect"
    );
    await waitForCondition(
      () => {
        const transitions = busBSubscriberStates.slice(transitionStart);
        return transitions.includes(false) && transitions.at(-1) === true;
      },
      "Subscriber did not reconnect and resubscribe"
    );

    const targetId = randomUUID();
    const received = waitForEvent(
      busB,
      (event) =>
        event.type === "reconnect_probe" && event.targetId === targetId
    );
    const published = await busA.publish({
      type: "reconnect_probe",
      scope: "user",
      targetId,
      payload: { type: "reconnect_probe" }
    });

    expect(published.published).toBe(true);
    await expect(received).resolves.toMatchObject({ targetId });
  });

  it("shares presence across replicas and expires stale connections", async () => {
    const userId = randomUUID();
    const connectionId = randomUUID();
    const presenceA = new PresenceService({
      redis: redisA,
      instanceId: "realtime-test-a",
      ttlMs: 120,
      heartbeatMs: 1_000
    });
    const presenceB = new PresenceService({
      redis: redisB,
      instanceId: "realtime-test-b",
      ttlMs: 120,
      heartbeatMs: 1_000
    });

    expect(await presenceB.register(userId, connectionId)).toBe(true);
    expect(await presenceA.isUserOnline(userId)).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 180));
    expect(await presenceA.isUserOnline(userId)).toBe(false);
    await presenceB.stop();
  });

  it("keeps local delivery alive and reports unknown presence without Redis", async () => {
    const localBus = new RealtimeEventBus({
      publisher: null,
      instanceId: "realtime-test-degraded",
      channel
    });
    const localPresence = new PresenceService({
      redis: null,
      instanceId: "realtime-test-degraded",
      ttlMs: 120,
      heartbeatMs: 1_000
    });
    let delivered = false;
    localBus.onEvent(() => {
      delivered = true;
    });

    await localBus.start();
    const result = await localBus.publish({
      type: "message",
      scope: "conversation",
      targetId: randomUUID(),
      payload: { type: "message" }
    });

    expect(result.published).toBe(false);
    expect(delivered).toBe(true);
    expect(await localPresence.isUserOnline(randomUUID())).toBeNull();
    await expect(
      localBus.publish(
        {
          type: "message",
          scope: "conversation",
          targetId: randomUUID(),
          payload: { type: "message" }
        },
        { strict: true }
      )
    ).rejects.toThrow("Redis is not configured");
    await localBus.stop();
  });
});
