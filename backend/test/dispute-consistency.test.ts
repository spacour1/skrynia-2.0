import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { pool } from "../src/db/pool.js";
import { getRedis } from "../src/common/redis.js";
import { issueSession } from "../src/modules/auth/session.service.js";
import { closeDb, createOrder, createProduct, createUser, resetDb } from "./fixtures.js";

vi.mock("../src/modules/orders/ledger.service.js", () => ({
  refundEscrow: vi.fn(),
  releaseEscrow: vi.fn()
}));

const { refundEscrow, releaseEscrow } = await import("../src/modules/orders/ledger.service.js");
const { recoverStaleDisputeResolutions } = await import(
  "../src/modules/disputes/dispute-resolution.service.js"
);
const { createApp } = await import("../src/app.js");
const app = createApp();

async function applyRefund(orderId: string) {
  await pool.query(`update orders set status = 'refunded', updated_at = now() where id = $1`, [
    orderId
  ]);
  return { id: orderId, status: "refunded" };
}

async function applyRelease(orderId: string) {
  await pool.query(`update orders set status = 'completed', updated_at = now() where id = $1`, [
    orderId
  ]);
  return { id: orderId, status: "completed" };
}

beforeEach(async () => {
  await resetDb();
  vi.mocked(refundEscrow).mockReset();
  vi.mocked(releaseEscrow).mockReset();
  vi.mocked(refundEscrow).mockImplementation(applyRefund);
  vi.mocked(releaseEscrow).mockImplementation(applyRelease);
});

afterAll(async () => {
  await getRedis()?.quit();
  await closeDb();
});

async function agentFor(userId: string, role: "user" | "admin" = "user") {
  const session = await issueSession(userId, role);
  const cookie = [`access_token=${session.accessToken}`, `csrf_token=${session.csrfToken}`];
  return {
    get: (path: string) => request(app).get(path).set("Cookie", cookie),
    post: (path: string) =>
      request(app)
        .post(path)
        .set("Cookie", cookie)
        .set("X-CSRF-Token", session.csrfToken)
  };
}

async function setupDisputableOrder() {
  const buyer = await createUser("user");
  const seller = await createUser("user");
  await pool.query(`update users set email_verified_at = now() where id = any($1::uuid[])`, [
    [buyer, seller]
  ]);
  const productId = await createProduct(seller);
  const orderId = await createOrder(buyer, seller, productId, { status: "paid" });
  return { buyer, seller, orderId };
}

async function openDispute() {
  const { buyer, seller, orderId } = await setupDisputableOrder();
  const buyerAgent = await agentFor(buyer);
  const opened = await buyerAgent
    .post(`/disputes/orders/${orderId}/dispute`)
    .send({ reason: "Seller never delivered anything" });
  expect(opened.status).toBe(201);
  const adminId = await createUser("admin");
  return {
    buyer,
    seller,
    orderId,
    disputeId: opened.body.dispute.id as string,
    adminId,
    buyerAgent,
    sellerAgent: await agentFor(seller),
    adminAgent: await agentFor(adminId, "admin")
  };
}

async function seedResolutionClaim(input: {
  disputeId: string;
  adminId: string;
  decision?: "refund" | "release";
  operationId?: string;
  stale?: boolean;
}) {
  const operationId = input.operationId ?? randomUUID();
  await pool.query(
    `update disputes
     set status = 'resolving',
         resolution_decision = $2,
         resolution_operation_id = $3,
         admin_id = $4,
         admin_note = 'Original resolution note',
         resolving_started_at = case
           when $5 then now() - interval '16 minutes'
           else now()
         end,
         resolution_attempts = 1,
         last_resolution_error = null,
         updated_at = now()
     where id = $1`,
    [
      input.disputeId,
      input.decision ?? "refund",
      operationId,
      input.adminId,
      input.stale ?? false
    ]
  );
  return operationId;
}

describe("dispute evidence and messages", () => {
  it("keeps the opening evidence immutable and moves follow-up evidence into messages", async () => {
    const {
      buyer,
      seller,
      orderId,
      disputeId,
      buyerAgent,
      sellerAgent
    } = await openDispute();
    const original = await pool.query<{
      openedBy: string;
      reason: string;
      createdAt: Date;
    }>(
      `select opened_by as "openedBy", reason, created_at as "createdAt"
       from disputes where id = $1`,
      [disputeId]
    );

    const repeated = await sellerAgent
      .post(`/disputes/orders/${orderId}/dispute`)
      .send({ reason: "Buyer description is not accurate at all" });
    expect(repeated.status).toBe(200);
    expect(repeated.body.messageSuggested).toBe(true);

    const afterRepeat = await pool.query<{
      openedBy: string;
      reason: string;
      createdAt: Date;
    }>(
      `select opened_by as "openedBy", reason, created_at as "createdAt"
       from disputes where id = $1`,
      [disputeId]
    );
    expect(afterRepeat.rows[0]).toEqual(original.rows[0]);
    expect(afterRepeat.rows[0].openedBy).toBe(buyer);

    const posted = await sellerAgent
      .post(`/disputes/${disputeId}/messages`)
      .send({ body: "The delivery proof is attached in the order conversation." });
    expect(posted.status).toBe(201);
    expect(posted.body.message.authorId).toBe(seller);

    const participantView = await buyerAgent.get(`/disputes/orders/${orderId}/dispute`);
    expect(participantView.status).toBe(200);
    expect(participantView.body.dispute.reason).toBe(original.rows[0].reason);
    expect(participantView.body.messages).toHaveLength(1);

    await expect(
      pool.query(`update disputes set reason = 'Rewritten evidence' where id = $1`, [disputeId])
    ).rejects.toThrow(/original evidence is immutable/i);
    await expect(
      pool.query(`update dispute_messages set body = 'Rewritten message' where id = $1`, [
        posted.body.message.id
      ])
    ).rejects.toThrow(/message content is immutable/i);
    await expect(
      pool.query(`delete from dispute_messages where id = $1`, [posted.body.message.id])
    ).rejects.toThrow(/append-only/i);

    const outsider = await createUser();
    const outsiderAgent = await agentFor(outsider);
    expect((await outsiderAgent.get(`/disputes/${disputeId}/messages`)).status).toBe(403);
    expect(
      (
        await outsiderAgent
          .post(`/disputes/${disputeId}/messages`)
          .send({ body: "I should not be able to add this evidence." })
      ).status
    ).toBe(403);

    const adminId = await createUser("admin");
    const adminAgent = await agentFor(adminId, "admin");
    const hidden = await adminAgent
      .post(`/disputes/${disputeId}/messages/${posted.body.message.id}/hide`)
      .send({ reason: "Contains private delivery evidence" });
    expect(hidden.status).toBe(200);

    const afterModeration = await buyerAgent.get(`/disputes/${disputeId}/messages`);
    expect(afterModeration.status).toBe(200);
    expect(afterModeration.body.messages).toHaveLength(0);
    const adminView = await adminAgent.get(`/disputes/${disputeId}/messages`);
    expect(adminView.body.messages[0]).toMatchObject({
      id: posted.body.message.id,
      hiddenBy: adminId,
      moderationReason: "Contains private delivery evidence"
    });
  });
});

describe("recoverable dispute resolution", () => {
  it("persists a failed operation and retries the same decision and operation ID", async () => {
    const { disputeId, adminAgent } = await openDispute();
    vi.mocked(refundEscrow).mockRejectedValueOnce(new Error("escrow backend down"));

    const failed = await adminAgent
      .post(`/disputes/${disputeId}/resolve`)
      .send({ decision: "refund", adminNote: "Refund the buyer" });
    expect(failed.status).toBeGreaterThanOrEqual(500);

    const failedState = await pool.query<{
      status: string;
      decision: string;
      operationId: string;
      attempts: number;
      error: string;
    }>(
      `select status,
              resolution_decision as decision,
              resolution_operation_id as "operationId",
              resolution_attempts as attempts,
              last_resolution_error as error
       from disputes where id = $1`,
      [disputeId]
    );
    expect(failedState.rows[0]).toMatchObject({
      status: "resolution_failed",
      decision: "refund",
      attempts: 1,
      error: "escrow backend down"
    });

    const opposite = await adminAgent
      .post(`/disputes/${disputeId}/resolve`)
      .send({ decision: "release", adminNote: "Try a different result" });
    expect(opposite.status).toBe(409);

    const retried = await adminAgent
      .post(`/disputes/${disputeId}/resolve`)
      .send({ decision: "refund", adminNote: "A replacement note must not win" });
    expect(retried.status).toBe(200);
    expect(retried.body.operationId).toBe(failedState.rows[0].operationId);
    expect(vi.mocked(refundEscrow)).toHaveBeenCalledTimes(2);

    const resolved = await pool.query(
      `select status, resolution, resolution_operation_id as "operationId",
              resolution_attempts as attempts, admin_note as "adminNote"
       from disputes where id = $1`,
      [disputeId]
    );
    expect(resolved.rows[0]).toEqual({
      status: "resolved",
      resolution: "refund",
      operationId: failedState.rows[0].operationId,
      attempts: 2,
      adminNote: "Refund the buyer"
    });
  });

  it("recovers a crash after claim but before escrow using the persisted operation", async () => {
    const { disputeId, adminId, adminAgent } = await openDispute();
    const operationId = await seedResolutionClaim({
      disputeId,
      adminId,
      decision: "refund",
      stale: true
    });

    const changedDecision = await adminAgent
      .post(`/disputes/${disputeId}/resolve`)
      .send({ decision: "release", adminNote: "Do not replace the original decision" });
    expect(changedDecision.status).toBe(409);
    expect(vi.mocked(refundEscrow)).not.toHaveBeenCalled();
    expect(vi.mocked(releaseEscrow)).not.toHaveBeenCalled();

    const recovered = await recoverStaleDisputeResolutions(disputeId);
    expect(recovered).toHaveLength(1);
    expect(recovered[0].operationId).toBe(operationId);
    expect(recovered[0].escrowExecuted).toBe(true);
    expect(vi.mocked(refundEscrow)).toHaveBeenCalledTimes(1);

    const state = await pool.query(
      `select status, resolution, resolution_operation_id as "operationId",
              resolution_attempts as attempts
       from disputes where id = $1`,
      [disputeId]
    );
    expect(state.rows[0]).toEqual({
      status: "resolved",
      resolution: "refund",
      operationId,
      attempts: 2
    });
  });

  it("recovers a crash after escrow without invoking escrow again", async () => {
    const { disputeId, orderId, adminId, adminAgent } = await openDispute();
    const operationId = await seedResolutionClaim({ disputeId, adminId });
    await pool.query(`update orders set status = 'refunded' where id = $1`, [orderId]);

    const recovered = await adminAgent
      .post(`/disputes/${disputeId}/resolve`)
      .send({ decision: "refund", adminNote: "Finish bookkeeping" });
    expect(recovered.status).toBe(200);
    expect(recovered.body.operationId).toBe(operationId);
    expect(vi.mocked(refundEscrow)).not.toHaveBeenCalled();

    const repeated = await adminAgent
      .post(`/disputes/${disputeId}/resolve`)
      .send({ decision: "refund", adminNote: "Repeat" });
    expect(repeated.status).toBe(200);
    expect(repeated.body.idempotent).toBe(true);
    expect(vi.mocked(refundEscrow)).not.toHaveBeenCalled();

    const opposite = await adminAgent
      .post(`/disputes/${disputeId}/resolve`)
      .send({ decision: "release", adminNote: "Opposite" });
    expect(opposite.status).toBe(409);
  });

  it("allows only one of two concurrent admins to execute escrow", async () => {
    const { disputeId, adminAgent } = await openDispute();
    const secondAdminId = await createUser("admin");
    const secondAdmin = await agentFor(secondAdminId, "admin");

    let signalEscrowStarted: (() => void) | undefined;
    let releaseEscrowAttempt: (() => void) | undefined;
    const escrowStarted = new Promise<void>((resolve) => {
      signalEscrowStarted = resolve;
    });
    const escrowGate = new Promise<void>((resolve) => {
      releaseEscrowAttempt = resolve;
    });
    vi.mocked(refundEscrow).mockImplementationOnce(async (orderId: string) => {
      signalEscrowStarted?.();
      await escrowGate;
      return applyRefund(orderId);
    });

    const firstPromise = adminAgent
      .post(`/disputes/${disputeId}/resolve`)
      .send({ decision: "refund", adminNote: "First admin claim" })
      .then((response) => response);
    await escrowStarted;

    const second = await secondAdmin
      .post(`/disputes/${disputeId}/resolve`)
      .send({ decision: "refund", adminNote: "Second admin claim" });
    releaseEscrowAttempt?.();
    const first = await firstPromise;

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(vi.mocked(refundEscrow)).toHaveBeenCalledTimes(1);
    const state = await pool.query(
      `select status, resolution, resolution_attempts as attempts
       from disputes where id = $1`,
      [disputeId]
    );
    expect(state.rows[0]).toEqual({
      status: "resolved",
      resolution: "refund",
      attempts: 1
    });
  });
});
