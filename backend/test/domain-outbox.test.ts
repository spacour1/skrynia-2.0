import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { outboxOldestPendingAgeSeconds } from "../src/common/metrics.js";
import { getRedis } from "../src/common/redis.js";
import { inTx, pool } from "../src/db/pool.js";
import { issueSession } from "../src/modules/auth/session.service.js";
import { enqueueDomainEvent } from "../src/modules/outbox/outbox.service.js";
import {
  processOutboxBatch,
  refreshOutboxMetrics,
  retryFailedOutboxEvents
} from "../src/modules/outbox/outbox.worker.js";
import {
  closeDb,
  createProduct,
  createUser,
  resetDb
} from "./fixtures.js";

const app = createApp();

beforeEach(resetDb);
afterAll(async () => {
  await getRedis()?.quit();
  await closeDb();
});

async function createTestEvent(eventKey = `test:${randomUUID()}`) {
  return inTx((client) =>
    enqueueDomainEvent(client, {
      eventKey,
      eventType: "product.blocked",
      aggregateType: "test",
      aggregateId: randomUUID(),
      payload: {
        productId: randomUUID(),
        sellerId: randomUUID(),
        categoryId: null,
        gameId: null,
        sectionId: null
      }
    })
  );
}

async function outboxRow(eventId: string) {
  const result = await pool.query(
    `select status, attempts, available_at as "availableAt",
            locked_at as "lockedAt", locked_by as "lockedBy",
            processed_at as "processedAt", last_error as "lastError"
     from domain_outbox
     where id = $1`,
    [eventId]
  );
  return result.rows[0];
}

describe("transactional domain outbox", () => {
  it("rolls the event back with its business transaction", async () => {
    const eventKey = `rollback:${randomUUID()}`;

    await expect(
      inTx(async (client) => {
        await enqueueDomainEvent(client, {
          eventKey,
          eventType: "product.blocked",
          aggregateType: "test",
          aggregateId: randomUUID(),
          payload: {}
        });
        throw new Error("rollback requested");
      })
    ).rejects.toThrow("rollback requested");

    const stored = await pool.query(
      `select count(*)::int as count from domain_outbox where event_key = $1`,
      [eventKey]
    );
    expect(stored.rows[0].count).toBe(0);
  });

  it("commits an order while delivery is unavailable, then delivers once without duplicates", async () => {
    const sellerId = await createUser();
    const buyerId = await createUser();
    await pool.query(
      `update users set email_verified_at = now() where id = $1`,
      [buyerId]
    );
    const productId = await createProduct(sellerId);
    const session = await issueSession(buyerId, "user");

    const created = await request(app)
      .post("/orders")
      .set("Cookie", [
        `access_token=${session.accessToken}`,
        `csrf_token=${session.csrfToken}`
      ])
      .set("X-CSRF-Token", session.csrfToken)
      .set("Idempotency-Key", randomUUID())
      .send({ productId, quantity: 1 });

    expect(created.status).toBe(201);
    const orderId = created.body.order.id as string;
    const committedOrder = await pool.query(
      `select id from orders where id = $1`,
      [orderId]
    );
    expect(committedOrder.rows[0]?.id).toBe(orderId);

    const eventResult = await pool.query<{ id: string }>(
      `select id from domain_outbox
       where event_key = $1 and status = 'pending'`,
      [`order.created:${orderId}`]
    );
    const eventId = eventResult.rows[0].id;
    const notificationsBefore = await pool.query(
      `select count(*)::int as count
       from notifications
       where user_id = $1 and type = 'order_created'`,
      [sellerId]
    );
    expect(notificationsBefore.rows[0].count).toBe(0);

    const scanSpy = vi
      .spyOn(getRedis()!, "scanStream")
      .mockImplementationOnce(() => {
        throw new Error("Redis unavailable");
      });
    const unavailable = await processOutboxBatch({
      workerId: "redis-unavailable",
      baseBackoffMs: 100
    });
    scanSpy.mockRestore();
    expect(unavailable).toEqual({ claimed: 1, processed: 0, failed: 1 });
    expect(await outboxRow(eventId)).toMatchObject({
      status: "pending",
      attempts: 1,
      lastError: "Redis unavailable",
      lockedAt: null,
      lockedBy: null,
      processedAt: null
    });

    await pool.query(
      `update domain_outbox set available_at = now() where id = $1`,
      [eventId]
    );
    const recovered = await processOutboxBatch({
      workerId: "redis-recovered"
    });
    expect(recovered).toEqual({ claimed: 1, processed: 1, failed: 0 });

    const notification = await pool.query(
      `select id, event_key as "eventKey"
       from notifications
       where user_id = $1 and type = 'order_created'`,
      [sellerId]
    );
    expect(notification.rows).toHaveLength(1);
    expect(notification.rows[0].eventKey).toContain(
      `order.created:${orderId}:notification:`
    );

    await pool.query(
      `update domain_outbox
       set status = 'pending',
           attempts = 0,
           available_at = now(),
           processed_at = null,
           locked_at = null,
           locked_by = null
       where id = $1`,
      [eventId]
    );
    const repeated = await processOutboxBatch({
      workerId: "delivery-repeated"
    });
    expect(repeated.processed).toBe(1);
    const notificationCount = await pool.query(
      `select count(*)::int as count
       from notifications
       where user_id = $1 and type = 'order_created'`,
      [sellerId]
    );
    expect(notificationCount.rows[0].count).toBe(1);
  });

  it("lets only one of two workers claim the same event", async () => {
    const event = await createTestEvent();
    let active = 0;
    let maxActive = 0;
    let calls = 0;
    const handler = async () => {
      calls += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 100));
      active -= 1;
    };

    const results = await Promise.all([
      processOutboxBatch({ workerId: "worker-a", handler }),
      processOutboxBatch({ workerId: "worker-b", handler })
    ]);

    expect(results.reduce((sum, result) => sum + result.claimed, 0)).toBe(1);
    expect(calls).toBe(1);
    expect(maxActive).toBe(1);
    expect(await outboxRow(event.id)).toMatchObject({
      status: "processed",
      attempts: 1
    });
  });

  it("processes a claimed batch in parallel", async () => {
    await Promise.all([
      createTestEvent(),
      createTestEvent(),
      createTestEvent()
    ]);
    let active = 0;
    let maxActive = 0;

    const result = await processOutboxBatch({
      workerId: "parallel-worker",
      concurrency: 3,
      handler: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 75));
        active -= 1;
      }
    });

    expect(result).toEqual({ claimed: 3, processed: 3, failed: 0 });
    expect(maxActive).toBeGreaterThan(1);
  });

  it("backs off, reaches failed, and can be explicitly retried", async () => {
    const event = await createTestEvent();
    const failingHandler = async () => {
      throw new Error("delivery failed");
    };

    await processOutboxBatch({
      workerId: "retry-worker",
      handler: failingHandler,
      maxAttempts: 2,
      baseBackoffMs: 200
    });
    const firstFailure = await outboxRow(event.id);
    expect(firstFailure).toMatchObject({
      status: "pending",
      attempts: 1,
      lastError: "delivery failed"
    });
    expect(new Date(firstFailure.availableAt).getTime()).toBeGreaterThan(
      Date.now()
    );

    await pool.query(
      `update domain_outbox set available_at = now() where id = $1`,
      [event.id]
    );
    await processOutboxBatch({
      workerId: "retry-worker",
      handler: failingHandler,
      maxAttempts: 2,
      baseBackoffMs: 200
    });
    expect(await outboxRow(event.id)).toMatchObject({
      status: "failed",
      attempts: 2,
      lastError: "delivery failed"
    });

    expect(
      await retryFailedOutboxEvents({ eventIds: [event.id] })
    ).toEqual([event.id]);
    expect(await outboxRow(event.id)).toMatchObject({
      status: "pending",
      attempts: 0,
      lastError: null
    });

    await processOutboxBatch({
      workerId: "retry-worker",
      handler: async () => undefined,
      maxAttempts: 2
    });
    expect(await outboxRow(event.id)).toMatchObject({
      status: "processed",
      attempts: 1
    });
  });

  it("reports the age of the oldest pending event", async () => {
    const event = await createTestEvent();
    await pool.query(
      `update domain_outbox
       set created_at = now() - interval '2 minutes'
       where id = $1`,
      [event.id]
    );

    await refreshOutboxMetrics();
    const metric = await outboxOldestPendingAgeSeconds.get();
    expect(metric.values[0]?.value).toBeGreaterThanOrEqual(119);
  });
});
