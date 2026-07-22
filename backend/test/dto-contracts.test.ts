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
 * Confirms two previously raw `select o.*` / `select d.*` responses (order detail,
 * admin dispute detail, admin dispute resolve) now serialize as clean camelCase DTOs
 * with no leaked internal snake_case columns.
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

async function agentFor(role: "user" | "admin" = "user") {
  const userId = await createUser(role);
  const session = await issueSession(userId, role);
  const cookie = [`access_token=${session.accessToken}`, `csrf_token=${session.csrfToken}`];
  return {
    userId,
    get: (path: string) => request(app).get(path).set("Cookie", cookie),
    post: (path: string) => request(app).post(path).set("Cookie", cookie).set("X-CSRF-Token", session.csrfToken)
  };
}

describe("order detail DTO", () => {
  it("GET /orders/:id has no snake_case keys", async () => {
    const buyer = await agentFor("user");
    const seller = await createUser("user");
    const product = await createProduct(seller);
    const orderId = await createOrder(buyer.userId, seller, product, { status: "paid" });

    const response = await buyer.get(`/orders/${orderId}`);
    expect(response.status).toBe(200);
    assertNoSnakeCaseKeys(response.body);
    expect(response.body.order.buyerId).toBe(buyer.userId);
    expect(response.body.order.sellerId).toBe(seller);
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
  });

  it("GET /disputes/:id (admin detail) has no snake_case keys", async () => {
    const { disputeId } = await openDispute();
    const admin = await agentFor("admin");
    const response = await admin.get(`/disputes/${disputeId}`);
    expect(response.status).toBe(200);
    assertNoSnakeCaseKeys(response.body);
    expect(response.body.dispute.orderId).toBeDefined();
    expect(response.body.dispute.buyerId).toBeDefined();
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
  });
});
