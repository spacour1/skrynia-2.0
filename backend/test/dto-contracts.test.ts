import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { getRedis } from "../src/common/redis.js";
import { issueSession } from "../src/modules/auth/session.service.js";
import { lockEscrow } from "../src/modules/orders/ledger.service.js";
import {
  closeDb,
  createOrder,
  createProduct,
  createUser,
  resetDb
} from "./fixtures.js";

/**
 * Confirms order and dispute HTTP responses serialize as clean camelCase DTOs with no
 * leaked internal snake_case columns.
 */

const app = createApp();

beforeEach(resetDb);
afterAll(async () => {
  await getRedis()?.quit();
  await closeDb();
});

function assertNoSnakeCaseKeys(value: unknown, path = "$"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSnakeCaseKeys(item, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object" && !(value instanceof Date)) {
    for (const [key, nested] of Object.entries(value)) {
      expect(key, `unexpected snake_case key at ${path}.${key}`).not.toMatch(/_/);
      assertNoSnakeCaseKeys(nested, `${path}.${key}`);
    }
  }
}

async function agentFor(role: "user" | "admin" = "user", verified = false) {
  const userId = await createUser(role);
  if (verified) {
    await pool.query(`update users set email_verified_at = now() where id = $1`, [userId]);
  }
  const session = await issueSession(userId, role);
  const cookie = [`access_token=${session.accessToken}`, `csrf_token=${session.csrfToken}`];
  return {
    userId,
    get: (path: string) => request(app).get(path).set("Cookie", cookie),
    post: (path: string) => request(app).post(path).set("Cookie", cookie).set("X-CSRF-Token", session.csrfToken)
  };
}

function expectIsoTimestamp(value: unknown): void {
  expect(typeof value).toBe("string");
  expect(new Date(value as string).toISOString()).toBe(value);
}

function assertOrderMutationDto(body: Record<string, unknown>): Record<string, unknown> {
  assertNoSnakeCaseKeys(body);
  const order = body.order as Record<string, unknown>;
  expect(order).toBeDefined();
  expect(typeof order.amountCents).toBe("string");
  expect(typeof order.feeCents).toBe("string");
  expect(order).not.toHaveProperty("paymentProvider");
  expect(order).not.toHaveProperty("paymentReference");
  expectIsoTimestamp(order.createdAt);
  expectIsoTimestamp(order.updatedAt);
  for (const field of ["autoReleaseAt", "paidAt", "deliveredAt", "completedAt"] as const) {
    if (order[field] !== null) expectIsoTimestamp(order[field]);
  }
  return order;
}

async function createEscrowedOrder() {
  const buyer = await agentFor("user", true);
  const seller = await agentFor("user", true);
  const productId = await createProduct(seller.userId);
  const orderId = await createOrder(buyer.userId, seller.userId, productId);
  await lockEscrow(orderId, buyer.userId, "mock");
  return { buyer, seller, productId, orderId };
}

describe("public order mutation DTOs", () => {
  it("POST /orders returns and replays a canonical order DTO", async () => {
    const sellerId = await createUser("user");
    const productId = await createProduct(sellerId);
    const buyer = await agentFor("user", true);
    const idempotencyKey = randomUUID();

    const createRequest = () =>
      buyer
        .post("/orders")
        .set("Idempotency-Key", idempotencyKey)
        .send({ productId, quantity: 1 });

    const response = await createRequest();
    expect(response.status).toBe(201);
    const order = assertOrderMutationDto(response.body);
    expect(order).toMatchObject({
      buyerId: buyer.userId,
      sellerId,
      productId,
      status: "pending",
      deliveryNote: null,
      autoReleaseAt: null,
      paidAt: null,
      deliveredAt: null,
      completedAt: null
    });

    const replay = await createRequest();
    expect(replay.status).toBe(201);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    assertNoSnakeCaseKeys(replay.body);
    expect(replay.body).toEqual(response.body);
  });

  it("POST /orders/:id/start returns a canonical order DTO", async () => {
    const { seller, orderId } = await createEscrowedOrder();

    const response = await seller.post(`/orders/${orderId}/start`).send({});
    expect(response.status).toBe(200);
    const order = assertOrderMutationDto(response.body);
    expect(order).toMatchObject({
      id: orderId,
      sellerId: seller.userId,
      status: "in_progress",
      deliveryNote: null,
      autoReleaseAt: null,
      deliveredAt: null,
      completedAt: null
    });
    expectIsoTimestamp(order.paidAt);
  });

  it("POST /orders/:id/deliver returns a canonical order DTO", async () => {
    const { seller, orderId } = await createEscrowedOrder();
    const started = await seller.post(`/orders/${orderId}/start`).send({});
    expect(started.status).toBe(200);

    const response = await seller
      .post(`/orders/${orderId}/deliver`)
      .send({ deliveryNote: "Delivery credentials" });
    expect(response.status).toBe(200);
    const order = assertOrderMutationDto(response.body);
    expect(order).toMatchObject({
      id: orderId,
      sellerId: seller.userId,
      status: "delivered",
      deliveryNote: "Delivery credentials",
      completedAt: null
    });
    expectIsoTimestamp(order.autoReleaseAt);
    expectIsoTimestamp(order.paidAt);
    expectIsoTimestamp(order.deliveredAt);
  });

  it("POST /orders/:id/confirm returns a canonical order DTO", async () => {
    const { buyer, seller, orderId } = await createEscrowedOrder();
    const started = await seller.post(`/orders/${orderId}/start`).send({});
    expect(started.status).toBe(200);
    const delivered = await seller
      .post(`/orders/${orderId}/deliver`)
      .send({ deliveryNote: "Delivery credentials" });
    expect(delivered.status).toBe(200);

    const response = await buyer.post(`/orders/${orderId}/confirm`).send({});
    expect(response.status).toBe(200);
    const order = assertOrderMutationDto(response.body);
    expect(order).toMatchObject({
      id: orderId,
      buyerId: buyer.userId,
      sellerId: seller.userId,
      status: "completed",
      deliveryNote: "Delivery credentials"
    });
    expectIsoTimestamp(order.autoReleaseAt);
    expectIsoTimestamp(order.paidAt);
    expectIsoTimestamp(order.deliveredAt);
    expectIsoTimestamp(order.completedAt);
  });
});

describe("order detail DTO", () => {
  it("keeps payment identifiers admin-only", async () => {
    const buyer = await agentFor("user");
    const seller = await createUser("user");
    const product = await createProduct(seller);
    const orderId = await createOrder(buyer.userId, seller, product, { status: "paid" });
    await pool.query(
      `update orders
       set payment_provider = 'mock', payment_reference = 'provider-secret-reference'
       where id = $1`,
      [orderId]
    );

    const response = await buyer.get(`/orders/${orderId}`);
    expect(response.status).toBe(200);
    assertNoSnakeCaseKeys(response.body);
    expect(response.body.order.buyerId).toBe(buyer.userId);
    expect(response.body.order.sellerId).toBe(seller);
    expect(typeof response.body.order.amountCents).toBe("string");
    expect(typeof response.body.order.feeCents).toBe("string");
    expect(response.body.order).not.toHaveProperty("paymentProvider");
    expect(response.body.order).not.toHaveProperty("paymentReference");

    const admin = await agentFor("admin");
    const adminResponse = await admin.get(`/orders/${orderId}`);
    expect(adminResponse.status).toBe(200);
    assertNoSnakeCaseKeys(adminResponse.body);
    expect(adminResponse.body.order).toMatchObject({
      paymentProvider: "mock",
      paymentReference: "provider-secret-reference"
    });
  });
});

describe("admin dispute DTOs", () => {
  async function openDispute() {
    const buyer = await createUser("user");
    const seller = await createUser("user");
    const product = await createProduct(seller, { priceCents: 2000 });
    const orderId = await createOrder(buyer, seller, product, { amountCents: 2000 });
    // Real escrow hold - the resolve endpoint moves real money, so the wallet needs
    // actual escrow_cents rather than just a raw 'disputed' status flip.
    await lockEscrow(orderId, buyer, "mock");
    await pool.query(`update orders set status = 'disputed', updated_at = now() where id = $1`, [orderId]);
    const dispute = await pool.query<{ id: string }>(
      `insert into disputes(order_id, opened_by, reason) values ($1, $2, 'Item not as described') returning id`,
      [orderId, buyer]
    );
    return { disputeId: dispute.rows[0].id, buyer, seller, orderId };
  }

  it("GET /disputes (admin list) has no snake_case keys", async () => {
    await openDispute();
    const admin = await agentFor("admin");
    const response = await admin.get("/disputes");
    expect(response.status).toBe(200);
    assertNoSnakeCaseKeys(response.body);
    expect(response.body.disputes).toHaveLength(1);
    expect(typeof response.body.disputes[0].amountCents).toBe("string");
    expectIsoTimestamp(response.body.disputes[0].createdAt);
    expect(response.body.disputes[0]).toMatchObject({
      resolutionOperationId: null,
      resolvingStartedAt: null,
      resolutionAttempts: 0,
      lastResolutionError: null,
      adminId: null,
      adminNote: null
    });
  });

  it("GET /disputes/:id (admin detail) has no snake_case keys", async () => {
    const { disputeId } = await openDispute();
    const admin = await agentFor("admin");
    const response = await admin.get(`/disputes/${disputeId}`);
    expect(response.status).toBe(200);
    assertNoSnakeCaseKeys(response.body);
    expect(response.body.dispute.orderId).toBeDefined();
    expect(response.body.dispute.buyerId).toBeDefined();
    expect(typeof response.body.dispute.amountCents).toBe("string");
    expectIsoTimestamp(response.body.dispute.createdAt);
    expect(response.body.dispute.resolvingStartedAt).toBeNull();
    expect(response.body.dispute).not.toHaveProperty("conversationId");
  });

  it("POST /disputes/:id/resolve response has no snake_case keys", async () => {
    const { disputeId } = await openDispute();
    const admin = await agentFor("admin");
    const response = await admin
      .post(`/disputes/${disputeId}/resolve`)
      .send({ decision: "refund", adminNote: "Refunding the buyer" });
    expect(response.status).toBe(200);
    assertNoSnakeCaseKeys(response.body);
    expect(response.body.dispute.resolutionDecision).toBe("refund");
    expect(response.body.dispute.orderId).toBeDefined();
    expect(typeof response.body.dispute.amountCents).toBe("string");
    expectIsoTimestamp(response.body.dispute.createdAt);
    expectIsoTimestamp(response.body.dispute.resolvingStartedAt);
    expectIsoTimestamp(response.body.dispute.resolvedAt);
    expect(response.body.dispute.resolutionAttempts).toBe(1);
    expect(response.body.dispute).not.toHaveProperty("conversationId");
    expect(response.body.order).toHaveProperty("paymentProvider");
    expect(response.body.order).toHaveProperty("paymentReference");
  });

  it("participant open-dispute response has no snake_case keys", async () => {
    const buyer = await createUser("user");
    const seller = await createUser("user");
    const product = await createProduct(seller, { priceCents: 2000 });
    const orderId = await createOrder(buyer, seller, product, { amountCents: 2000 });
    await lockEscrow(orderId, buyer, "mock");
    await pool.query(`update users set email_verified_at = now() where id = $1`, [buyer]);
    const session = await issueSession(buyer, "user");
    const cookie = [`access_token=${session.accessToken}`, `csrf_token=${session.csrfToken}`];

    const response = await request(app)
      .post(`/disputes/orders/${orderId}/dispute`)
      .set("Cookie", cookie)
      .set("X-CSRF-Token", session.csrfToken)
      .send({ reason: "Never received the item" });

    expect(response.status).toBe(201);
    assertNoSnakeCaseKeys(response.body);
    expect(response.body.dispute.orderId).toBe(orderId);
    expect(response.body.dispute.resolutionDecision).toBeNull();
    expectIsoTimestamp(response.body.dispute.createdAt);
    expect(response.body.dispute.resolvedAt).toBeNull();
    for (const field of [
      "resolutionOperationId",
      "resolvingStartedAt",
      "resolutionAttempts",
      "lastResolutionError",
      "adminId",
      "adminNote",
      "buyerId",
      "sellerId",
      "amountCents",
      "currency",
      "orderStatus",
      "productTitle"
    ]) {
      expect(response.body.dispute).not.toHaveProperty(field);
    }
  });
});
