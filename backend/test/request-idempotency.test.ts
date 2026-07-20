import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { getRedis } from "../src/common/redis.js";
import { pool } from "../src/db/pool.js";
import { issueSession } from "../src/modules/auth/session.service.js";
import { sendMessageIdempotently } from "../src/modules/chat/chat.service.js";
import { hashIdempotencyPayload } from "../src/modules/idempotency/idempotency.service.js";
import { processOutboxBatch } from "../src/modules/outbox/outbox.worker.js";
import {
  closeDb,
  createConversation,
  createOrder,
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

async function verifiedSession(userId: string) {
  await pool.query(
    `update users set email_verified_at = now() where id = $1`,
    [userId]
  );
  return issueSession(userId, "user");
}

function postAs(
  session: Awaited<ReturnType<typeof issueSession>>,
  path: string,
  body: unknown
) {
  return request(app)
    .post(path)
    .set("Cookie", [
      `access_token=${session.accessToken}`,
      `csrf_token=${session.csrfToken}`
    ])
    .set("X-CSRF-Token", session.csrfToken)
    .send(body);
}

describe("request idempotency", () => {
  it("creates one order for two concurrent requests and delivers one notification", async () => {
    const sellerId = await createUser();
    const buyerId = await createUser();
    const productId = await createProduct(sellerId);
    const session = await verifiedSession(buyerId);
    const key = randomUUID();

    const makeRequest = () =>
      postAs(session, "/orders", { productId, quantity: 1 }).set(
        "Idempotency-Key",
        key
      );
    const [first, second] = await Promise.all([makeRequest(), makeRequest()]);

    expect([first.status, second.status]).toEqual([201, 201]);
    expect(first.body.order.id).toBe(second.body.order.id);
    expect(first.body.conversationId).toBe(second.body.conversationId);
    expect(
      [first, second].filter(
        (response) => response.headers["idempotency-replayed"] === "true"
      )
    ).toHaveLength(1);

    const stored = await pool.query(
      `select
         (select count(*)::int from orders where buyer_id = $1 and product_id = $2) as orders,
         (select count(*)::int from domain_outbox
           where event_key = $3) as events,
         (select count(*)::int from idempotency_keys
           where user_id = $1 and scope = 'orders.create' and key = $4
             and status = 'completed') as keys`,
      [buyerId, productId, `order.created:${first.body.order.id}`, key]
    );
    expect(stored.rows[0]).toMatchObject({ orders: 1, events: 1, keys: 1 });

    const processed = await processOutboxBatch({
      workerId: "order-idempotency-test"
    });
    expect(processed).toMatchObject({ claimed: 1, processed: 1 });
    const notifications = await pool.query(
      `select count(*)::int as count
       from notifications
       where user_id = $1 and type = 'order_created'`,
      [sellerId]
    );
    expect(notifications.rows[0].count).toBe(1);
  });

  it("rejects a missing key, a changed body, and a committed processing state", async () => {
    const sellerId = await createUser();
    const buyerId = await createUser();
    const productId = await createProduct(sellerId);
    const session = await verifiedSession(buyerId);

    const missing = await postAs(session, "/orders", {
      productId,
      quantity: 1
    });
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe("idempotency_key_invalid");

    const key = randomUUID();
    const created = await postAs(session, "/orders", {
      productId,
      quantity: 1
    }).set("Idempotency-Key", key);
    expect(created.status).toBe(201);

    const changed = await postAs(session, "/orders", {
      productId,
      quantity: 2
    }).set("Idempotency-Key", key);
    expect(changed.status).toBe(409);
    expect(changed.body.error.code).toBe("idempotency_key_reused");

    const processingKey = randomUUID();
    await pool.query(
      `insert into idempotency_keys(
         user_id, scope, key, request_hash, status, expires_at
       )
       values ($1, 'orders.create', $2, $3, 'processing', now() + interval '1 hour')`,
      [
        buyerId,
        processingKey,
        hashIdempotencyPayload({ productId, quantity: 1 })
      ]
    );
    const processing = await postAs(session, "/orders", {
      productId,
      quantity: 1
    }).set("Idempotency-Key", processingKey);
    expect(processing.status).toBe(409);
    expect(processing.body.error.code).toBe("idempotency_in_progress");

    const count = await pool.query(
      `select count(*)::int as count
       from orders where buyer_id = $1 and product_id = $2`,
      [buyerId, productId]
    );
    expect(count.rows[0].count).toBe(1);
  });

  it("returns the same message after a transport retry without a second outbox event", async () => {
    const sellerId = await createUser();
    const buyerId = await createUser();
    const conversationId = await createConversation(buyerId, sellerId);
    const session = await verifiedSession(buyerId);
    const clientMessageId = randomUUID();

    const websocketResult = await sendMessageIdempotently({
      conversationId,
      senderId: buyerId,
      clientMessageId,
      body: "Retry-safe hello"
    });
    expect(websocketResult.created).toBe(true);

    const retry = await postAs(
      session,
      `/chat/conversations/${conversationId}/messages`,
      { clientMessageId, body: "Retry-safe hello" }
    );
    expect(retry.status).toBe(200);
    expect(retry.headers["idempotency-replayed"]).toBe("true");
    expect(retry.body.message.id).toBe(websocketResult.message.id);

    const changed = await postAs(
      session,
      `/chat/conversations/${conversationId}/messages`,
      { clientMessageId, body: "Changed content" }
    );
    expect(changed.status).toBe(409);
    expect(changed.body.error.code).toBe("client_message_id_reused");

    const stored = await pool.query(
      `select
         (select count(*)::int from messages
           where sender_id = $1 and client_message_id = $2) as messages,
         (select count(*)::int from domain_outbox
           where event_key = $3) as events`,
      [
        buyerId,
        clientMessageId,
        `message.created:${websocketResult.message.id}`
      ]
    );
    expect(stored.rows[0]).toMatchObject({ messages: 1, events: 1 });
  });

  it("replays an identical review and rejects different review content", async () => {
    const sellerId = await createUser();
    const buyerId = await createUser();
    const productId = await createProduct(sellerId);
    const orderId = await createOrder(buyerId, sellerId, productId, {
      status: "completed"
    });
    const session = await verifiedSession(buyerId);

    const first = await postAs(session, `/orders/${orderId}/review`, {
      rating: 5,
      comment: "Excellent"
    });
    expect(first.status).toBe(201);

    const replay = await postAs(session, `/orders/${orderId}/review`, {
      rating: 5,
      comment: "Excellent"
    });
    expect(replay.status).toBe(200);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect(replay.body.review.id).toBe(first.body.review.id);

    const changed = await postAs(session, `/orders/${orderId}/review`, {
      rating: 4,
      comment: "Excellent"
    });
    expect(changed.status).toBe(409);
    expect(changed.body.error.code).toBe("review_already_exists");

    const stored = await pool.query(
      `select
         (select count(*)::int from reviews where order_id = $1) as reviews,
         (select count(*)::int from order_events
           where order_id = $1 and type = 'review_created') as timeline_events,
         (select count(*)::int from domain_outbox
           where event_key = $2) as outbox_events`,
      [orderId, `review.created:${first.body.review.id}`]
    );
    expect(stored.rows[0]).toMatchObject({
      reviews: 1,
      timeline_events: 1,
      outbox_events: 1
    });
  });
});
