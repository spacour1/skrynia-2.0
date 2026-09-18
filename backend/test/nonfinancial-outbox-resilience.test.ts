import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getRedis } from "../src/common/redis.js";
import { env } from "../src/config/env.js";
import { inTx, pool } from "../src/db/pool.js";
import { closeJobQueue } from "../src/modules/jobs/queue.js";
import { enqueueDomainEvent } from "../src/modules/outbox/outbox.service.js";
import { processOutboxBatch } from "../src/modules/outbox/outbox.worker.js";
import { RealtimeEventBus } from "../src/modules/realtime/realtime-event-bus.service.js";
import {
  closeDb,
  createConversation,
  createUser,
  resetDb
} from "./fixtures.js";

beforeEach(resetDb);
afterAll(async () => {
  await closeJobQueue();
  await getRedis()?.quit();
  await closeDb();
});

async function createMessageCreatedEvent() {
  const messageId = randomUUID();
  return inTx((client) =>
    enqueueDomainEvent(client, {
      eventKey: `message.created:stage6:${messageId}`,
      eventType: "message.created",
      aggregateType: "message",
      aggregateId: messageId,
      payload: { messageId }
    })
  );
}

async function readLease(eventId: string) {
  const result = await pool.query<{
    status: string;
    attempts: number;
    lockedAt: Date | null;
    lockedBy: string | null;
    lastError: string | null;
  }>(
    `select status, attempts, locked_at as "lockedAt", locked_by as "lockedBy",
            last_error as "lastError"
     from domain_outbox
     where id = $1`,
    [eventId]
  );
  return result.rows[0];
}

describe("nonfinancial outbox lease recovery", () => {
  it("heartbeats a slow handler so another worker cannot reclaim its lease", async () => {
    const event = await createMessageCreatedEvent();
    let releaseHandler!: () => void;
    let signalStarted!: () => void;
    const handlerStarted = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const handlerReleased = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });

    const firstWorker = processOutboxBatch({
      workerId: "stage6-heartbeat-owner",
      lockTimeoutMs: 300,
      handler: async () => {
        signalStarted();
        await handlerReleased;
      }
    });

    await handlerStarted;
    try {
      const initialLease = await readLease(event.id);
      expect(initialLease).toMatchObject({
        status: "processing",
        attempts: 1,
        lockedBy: "stage6-heartbeat-owner"
      });
      expect(initialLease.lockedAt).not.toBeNull();

      await vi.waitFor(
        async () => {
          const renewedLease = await readLease(event.id);
          expect(renewedLease.lockedAt?.getTime()).toBeGreaterThan(
            initialLease.lockedAt!.getTime()
          );
        },
        { timeout: 2_000, interval: 25 }
      );

      const competingWorker = await processOutboxBatch({
        workerId: "stage6-heartbeat-competitor",
        lockTimeoutMs: 300,
        handler: async () => {
          throw new Error("a live lease must not be reclaimed");
        }
      });
      expect(competingWorker).toEqual({ claimed: 0, processed: 0, failed: 0 });

      releaseHandler();
      await expect(firstWorker).resolves.toEqual({
        claimed: 1,
        processed: 1,
        failed: 0
      });
      expect(await readLease(event.id)).toMatchObject({
        status: "processed",
        attempts: 1,
        lockedAt: null,
        lockedBy: null
      });
    } finally {
      releaseHandler();
      await firstWorker.catch(() => undefined);
    }
  });

  it("reclaims a crashed worker lease and completes it once", async () => {
    const event = await createMessageCreatedEvent();
    await pool.query(
      `update domain_outbox
       set status = 'processing', attempts = 1,
           locked_at = now() - interval '10 seconds',
           locked_by = 'stage6-crashed-worker'
       where id = $1`,
      [event.id]
    );

    let deliveries = 0;
    const recovered = await processOutboxBatch({
      workerId: "stage6-recovery-worker",
      lockTimeoutMs: 100,
      maxAttempts: 3,
      handler: async () => {
        deliveries += 1;
      }
    });

    expect(recovered).toEqual({ claimed: 1, processed: 1, failed: 0 });
    expect(deliveries).toBe(1);
    expect(await readLease(event.id)).toMatchObject({
      status: "processed",
      attempts: 2,
      lockedAt: null,
      lockedBy: null,
      lastError: null
    });
  });

  it("fails an expired crashed lease that already exhausted its attempts", async () => {
    const event = await createMessageCreatedEvent();
    await pool.query(
      `update domain_outbox
       set status = 'processing', attempts = 3,
           locked_at = now() - interval '10 seconds',
           locked_by = 'stage6-exhausted-worker',
           last_error = null
       where id = $1`,
      [event.id]
    );

    const result = await processOutboxBatch({
      workerId: "stage6-terminal-recovery",
      lockTimeoutMs: 100,
      maxAttempts: 3,
      handler: async () => {
        throw new Error("an exhausted event must not run again");
      }
    });

    expect(result).toEqual({ claimed: 0, processed: 0, failed: 0 });
    expect(await readLease(event.id)).toMatchObject({
      status: "failed",
      attempts: 3,
      lockedAt: null,
      lockedBy: null,
      lastError: "Worker lock expired after maximum attempts"
    });
  });

  it("deduplicates realtime delivery when the same message event is replayed", async () => {
    const redis = getRedis()!;
    const observer = new RealtimeEventBus({
      publisher: redis,
      instanceId: `stage6-replay-observer:${randomUUID()}`,
      channel: env.REALTIME_CHANNEL
    });
    const deliveredEventIds: string[] = [];
    observer.onEvent((event) => {
      if (event.type === "message") deliveredEventIds.push(event.id);
    });
    await observer.start();

    try {
      const senderId = await createUser();
      const recipientId = await createUser();
      const conversationId = await createConversation(senderId, recipientId);
      const messageId = randomUUID();
      await pool.query(
        `insert into messages(id, conversation_id, sender_id, body)
         values ($1, $2, $3, 'stage6 stable realtime id')`,
        [messageId, conversationId, senderId]
      );
      const event = await inTx((client) =>
        enqueueDomainEvent(client, {
          eventKey: `message.created:${messageId}`,
          eventType: "message.created",
          aggregateType: "message",
          aggregateId: messageId,
          payload: { messageId }
        })
      );

      expect(
        await processOutboxBatch({ workerId: "stage6-realtime-first" })
      ).toEqual({ claimed: 1, processed: 1, failed: 0 });
      await vi.waitFor(
        () => expect(deliveredEventIds).toEqual([messageId]),
        { timeout: 2_000, interval: 25 }
      );

      await pool.query(
        `update domain_outbox
         set status = 'pending', attempts = 0, available_at = now(),
             processed_at = null, locked_at = null, locked_by = null
         where id = $1`,
        [event.id]
      );
      expect(
        await processOutboxBatch({ workerId: "stage6-realtime-replay" })
      ).toEqual({ claimed: 1, processed: 1, failed: 0 });
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(deliveredEventIds).toEqual([messageId]);
    } finally {
      await observer.stop();
    }
  });

  it("does not deliver a delayed message.created event after the message was hidden", async () => {
    const redis = getRedis()!;
    const observer = new RealtimeEventBus({
      publisher: redis,
      instanceId: `stage7-hidden-message-observer:${randomUUID()}`,
      channel: env.REALTIME_CHANNEL
    });
    const delivered: unknown[] = [];
    observer.onEvent((event) => {
      if (event.type === "message") delivered.push(event.payload);
    });
    await observer.start();

    try {
      const senderId = await createUser();
      const recipientId = await createUser();
      const conversationId = await createConversation(senderId, recipientId);
      const messageId = randomUUID();
      await pool.query(
        `insert into messages(id, conversation_id, sender_id, body, hidden_at)
         values ($1, $2, $3, 'moderated secret body', now())`,
        [messageId, conversationId, senderId]
      );
      await inTx((client) =>
        enqueueDomainEvent(client, {
          eventKey: `message.created:stage7-hidden:${messageId}`,
          eventType: "message.created",
          aggregateType: "message",
          aggregateId: messageId,
          payload: { messageId }
        })
      );

      expect(await processOutboxBatch({ workerId: "stage7-hidden-message" })).toEqual({
        claimed: 1,
        processed: 1,
        failed: 0
      });
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(delivered).toEqual([]);
      const notifications = await pool.query<{ count: number }>(
        `select count(*)::int as count
         from notifications
         where conversation_id = $1 and type = 'message'`,
        [conversationId]
      );
      expect(notifications.rows[0].count).toBe(0);
    } finally {
      await observer.stop();
    }
  });

  it("broadcasts canonical message state when stale moderation events are replayed", async () => {
    const redis = getRedis()!;
    const observer = new RealtimeEventBus({
      publisher: redis,
      instanceId: `stage7-moderation-observer:${randomUUID()}`,
      channel: env.REALTIME_CHANNEL
    });
    const delivered: Array<{ hidden: boolean; conversationId: string; messageId: string }> = [];
    observer.onEvent((event) => {
      if (event.type === "message.moderated") {
        delivered.push(event.payload as { hidden: boolean; conversationId: string; messageId: string });
      }
    });
    await observer.start();

    try {
      const senderId = await createUser();
      const recipientId = await createUser();
      const conversationId = await createConversation(senderId, recipientId);
      const messageId = randomUUID();
      await pool.query(
        `insert into messages(id, conversation_id, sender_id, body)
         values ($1, $2, $3, 'canonical moderation state')`,
        [messageId, conversationId, senderId]
      );
      await inTx((client) =>
        enqueueDomainEvent(client, {
          eventKey: `message.moderated:stage7-stale-hide:${messageId}`,
          eventType: "message.moderated",
          aggregateType: "message",
          aggregateId: messageId,
          payload: { messageId, conversationId, hidden: true }
        })
      );
      expect(await processOutboxBatch({ workerId: "stage7-stale-hide" })).toEqual({
        claimed: 1,
        processed: 1,
        failed: 0
      });
      await vi.waitFor(() => expect(delivered).toHaveLength(1), { timeout: 2_000, interval: 25 });
      expect(delivered[0]).toEqual({
        type: "message.moderated",
        messageId,
        conversationId,
        hidden: false
      });

      await pool.query(`update messages set hidden_at = now() where id = $1`, [messageId]);
      await inTx((client) =>
        enqueueDomainEvent(client, {
          eventKey: `message.moderated:stage7-stale-restore:${messageId}`,
          eventType: "message.moderated",
          aggregateType: "message",
          aggregateId: messageId,
          payload: { messageId, conversationId, hidden: false }
        })
      );
      expect(await processOutboxBatch({ workerId: "stage7-stale-restore" })).toEqual({
        claimed: 1,
        processed: 1,
        failed: 0
      });
      await vi.waitFor(() => expect(delivered).toHaveLength(2), { timeout: 2_000, interval: 25 });
      expect(delivered[1]).toEqual({
        type: "message.moderated",
        messageId,
        conversationId,
        hidden: true
      });
    } finally {
      await observer.stop();
    }
  });
});
