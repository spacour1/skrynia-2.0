import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { pool } from "../src/db/pool.js";
import { getRedis } from "../src/common/redis.js";
import { issueSession } from "../src/modules/auth/session.service.js";
import { closeDb, createOrder, createProduct, createUser, resetDb } from "./fixtures.js";

/**
 * Dispute orchestration consistency. The escrow services are mocked here on purpose:
 * their financial behaviour is covered by ledger.test.ts and must not change - these
 * tests pin the NEW guarantees around them:
 *  - opening is transactional and idempotent (no `order=disputed` without a dispute row);
 *  - resolution claims the dispute atomically, so refund/release runs at most once;
 *  - an escrow failure releases the claim (retryable);
 *  - a crash between escrow success and the final update is recoverable without
 *    re-running the escrow operation.
 */

vi.mock("../src/modules/orders/ledger.service.js", () => ({
  refundEscrow: vi.fn(async (orderId: string) => {
    await pool.query(`update orders set status = 'refunded', updated_at = now() where id = $1`, [orderId]);
    return { id: orderId, status: "refunded" };
  }),
  releaseEscrow: vi.fn(async (orderId: string) => {
    await pool.query(`update orders set status = 'completed', updated_at = now() where id = $1`, [orderId]);
    return { id: orderId, status: "completed" };
  })
}));

const { refundEscrow } = await import("../src/modules/orders/ledger.service.js");
const { createApp } = await import("../src/app.js");
const app = createApp();

beforeEach(async () => {
  await resetDb();
  vi.mocked(refundEscrow).mockClear();
});
afterAll(async () => {
  await getRedis()?.quit();
  await closeDb();
});

async function agentFor(userId: string, role: "user" | "admin" = "user") {
  const session = await issueSession(userId, role);
  const cookie = [`access_token=${session.accessToken}`, `csrf_token=${session.csrfToken}`];
  return {
    post: (path: string) => request(app).post(path).set("Cookie", cookie).set("X-CSRF-Token", session.csrfToken)
  };
}

async function setupDisputableOrder() {
  const buyer = await createUser("user");
  const seller = await createUser("user");
  await pool.query(`update users set email_verified_at = now() where id = any($1::uuid[])`, [[buyer, seller]]);
  const productId = await createProduct(seller);
  const orderId = await createOrder(buyer, seller, productId, { status: "paid" });
  return { buyer, seller, orderId };
}

describe("dispute open", () => {
  it("creates the dispute and flips the order atomically; a repeat open is idempotent", async () => {
    const { buyer, orderId } = await setupDisputableOrder();
    const agent = await agentFor(buyer);

    const first = await agent.post(`/disputes/orders/${orderId}/dispute`).send({ reason: "Seller never delivered anything" });
    expect(first.status).toBe(201);

    const order = await pool.query<{ status: string }>(`select status from orders where id = $1`, [orderId]);
    expect(order.rows[0].status).toBe("disputed");
    const disputes = await pool.query(`select status from disputes where order_id = $1`, [orderId]);
    expect(disputes.rows).toHaveLength(1);
    expect(disputes.rows[0].status).toBe("open");

    const repeat = await agent.post(`/disputes/orders/${orderId}/dispute`).send({ reason: "Updated reason after retry" });
    expect(repeat.status).toBe(200);
    const after = await pool.query(`select reason from disputes where order_id = $1`, [orderId]);
    expect(after.rows).toHaveLength(1);
    expect(after.rows[0].reason).toBe("Updated reason after retry");
  });
});

describe("dispute resolve", () => {
  async function openDispute() {
    const { buyer, orderId } = await setupDisputableOrder();
    const agent = await agentFor(buyer);
    const opened = await agent.post(`/disputes/orders/${orderId}/dispute`).send({ reason: "Seller never delivered anything" });
    expect(opened.status).toBe(201);
    const admin = await createUser("admin");
    return { orderId, disputeId: opened.body.dispute.id as string, admin: await agentFor(admin, "admin") };
  }

  it("resolves once and rejects a second resolve without re-running escrow", async () => {
    const { disputeId, orderId, admin } = await openDispute();

    const first = await admin.post(`/disputes/${disputeId}/resolve`).send({ decision: "refund", adminNote: "refund the buyer" });
    expect(first.status).toBe(200);
    expect(vi.mocked(refundEscrow)).toHaveBeenCalledTimes(1);

    const second = await admin.post(`/disputes/${disputeId}/resolve`).send({ decision: "refund", adminNote: "again" });
    expect(second.status).toBe(400);
    expect(vi.mocked(refundEscrow)).toHaveBeenCalledTimes(1);

    const state = await pool.query(`select d.status as dispute_status, o.status as order_status from disputes d join orders o on o.id = d.order_id where d.id = $1`, [disputeId]);
    expect(state.rows[0]).toEqual({ dispute_status: "resolved", order_status: "refunded" });
    void orderId;
  });

  it("releases the claim when the escrow operation fails, so resolve is retryable", async () => {
    const { disputeId, admin } = await openDispute();
    vi.mocked(refundEscrow).mockRejectedValueOnce(new Error("escrow backend down"));

    const failed = await admin.post(`/disputes/${disputeId}/resolve`).send({ decision: "refund", adminNote: "try refund" });
    expect(failed.status).toBeGreaterThanOrEqual(500);

    const midState = await pool.query(`select status from disputes where id = $1`, [disputeId]);
    expect(midState.rows[0].status).toBe("open");

    const retried = await admin.post(`/disputes/${disputeId}/resolve`).send({ decision: "refund", adminNote: "retry refund" });
    expect(retried.status).toBe(200);
    expect(vi.mocked(refundEscrow)).toHaveBeenCalledTimes(2);
  });

  it("finishes a dispute stuck in 'resolving' with a terminal order without touching escrow again", async () => {
    const { disputeId, orderId, admin } = await openDispute();
    // Simulate a crash after the escrow op but before the final dispute update.
    await pool.query(`update disputes set status = 'resolving' where id = $1`, [disputeId]);
    await pool.query(`update orders set status = 'refunded' where id = $1`, [orderId]);

    const retry = await admin.post(`/disputes/${disputeId}/resolve`).send({ decision: "refund", adminNote: "finish bookkeeping" });
    expect(retry.status).toBe(200);
    expect(vi.mocked(refundEscrow)).not.toHaveBeenCalled();

    const state = await pool.query(`select status, resolution from disputes where id = $1`, [disputeId]);
    expect(state.rows[0]).toEqual({ status: "resolved", resolution: "refund" });
  });

  it("never leaves order=refunded with dispute=open after a successful resolve", async () => {
    const { disputeId, admin } = await openDispute();
    const response = await admin.post(`/disputes/${disputeId}/resolve`).send({ decision: "refund", adminNote: "refund approved" });
    expect(response.status).toBe(200);
    const state = await pool.query(
      `select d.status as dispute_status, o.status as order_status
       from disputes d join orders o on o.id = d.order_id where d.id = $1`,
      [disputeId]
    );
    expect(state.rows[0].order_status).toBe("refunded");
    expect(state.rows[0].dispute_status).toBe("resolved");
  });
});
