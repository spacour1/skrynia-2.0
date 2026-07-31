import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { getRedis } from "../src/common/redis.js";
import { pool } from "../src/db/pool.js";
import { issueSession } from "../src/modules/auth/session.service.js";
import {
  closeDb,
  createOrder,
  createProduct,
  createUser,
  resetDb
} from "./fixtures.js";

const app = createApp();

type TestRole = "user" | "moderator" | "admin";

beforeEach(resetDb);

afterAll(async () => {
  await getRedis()?.quit();
  await closeDb();
});

async function agentFor(userId: string, role: TestRole) {
  const session = await issueSession(userId, role);
  const cookie = [
    `access_token=${session.accessToken}`,
    `csrf_token=${session.csrfToken}`
  ];
  return {
    get: (path: string) => request(app).get(path).set("Cookie", cookie),
    post: (path: string) =>
      request(app)
        .post(path)
        .set("Cookie", cookie)
        .set("X-CSRF-Token", session.csrfToken)
  };
}

async function seedDispute() {
  const buyerId = await createUser("user");
  const sellerId = await createUser("user");
  const moderatorId = await createUser("moderator");
  const adminId = await createUser("admin");
  const outsiderId = await createUser("user");
  const productId = await createProduct(sellerId);
  const orderId = await createOrder(buyerId, sellerId, productId, {
    status: "disputed"
  });
  const inserted = await pool.query<{ id: string }>(
    `insert into disputes(order_id, opened_by, reason)
     values ($1, $2, 'The delivered credentials do not work')
     returning id`,
    [orderId, buyerId]
  );
  const disputeId = inserted.rows[0].id;
  const operationId = randomUUID();
  const resolvingStartedAt = new Date("2026-07-20T10:20:30.000Z");
  await pool.query(
    `update disputes
     set status = 'resolution_failed',
         resolution_decision = 'refund',
         resolution_operation_id = $2,
         resolving_started_at = $4,
         resolution_attempts = 2,
         last_resolution_error = 'internal retry detail',
         admin_id = $3,
         admin_note = 'private admin note'
     where id = $1`,
    [disputeId, operationId, adminId, resolvingStartedAt]
  );

  return {
    buyerId,
    sellerId,
    moderatorId,
    adminId,
    outsiderId,
    orderId,
    disputeId,
    operationId,
    resolvingStartedAt
  };
}

function expectNoModerationFields(message: Record<string, unknown>) {
  expect(message).not.toHaveProperty("hiddenAt");
  expect(message).not.toHaveProperty("hiddenBy");
  expect(message).not.toHaveProperty("moderationReason");
}

describe("dispute moderator permissions", () => {
  it("allows global review and replies without exposing admin-only data or actions", async () => {
    const fixture = await seedDispute();
    const moderator = await agentFor(fixture.moderatorId, "moderator");
    const admin = await agentFor(fixture.adminId, "admin");
    const buyer = await agentFor(fixture.buyerId, "user");

    const list = await moderator.get("/disputes");
    expect(list.status).toBe(200);
    expect(list.body.disputes).toHaveLength(1);
    expect(list.body.disputes[0].id).toBe(fixture.disputeId);
    expect(typeof list.body.disputes[0].amountCents).toBe("string");
    for (const field of [
      "resolutionOperationId",
      "resolvingStartedAt",
      "resolutionAttempts",
      "lastResolutionError",
      "adminId",
      "adminNote",
      "buyerId",
      "sellerId"
    ]) {
      expect(list.body.disputes[0]).not.toHaveProperty(field);
    }

    const detail = await moderator.get(`/disputes/${fixture.disputeId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.dispute.id).toBe(fixture.disputeId);
    expect(typeof detail.body.dispute.amountCents).toBe("string");
    expect(detail.body.dispute).not.toHaveProperty("conversationId");
    for (const field of [
      "resolutionOperationId",
      "resolvingStartedAt",
      "resolutionAttempts",
      "lastResolutionError",
      "adminId",
      "adminNote",
      "buyerId",
      "sellerId"
    ]) {
      expect(detail.body.dispute).not.toHaveProperty(field);
    }

    const orderView = await moderator.get(
      `/disputes/orders/${fixture.orderId}/dispute`
    );
    expect(orderView.status).toBe(200);
    expect(orderView.body.dispute.id).toBe(fixture.disputeId);
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
      expect(orderView.body.dispute).not.toHaveProperty(field);
    }
    expect(orderView.body.dispute.createdAt).toBeTypeOf("string");
    expect(orderView.body.dispute.resolutionDecision).toBe("refund");

    const participantView = await buyer.get(
      `/disputes/orders/${fixture.orderId}/dispute`
    );
    expect(participantView.status).toBe(200);
    expect(participantView.body.dispute).toEqual(orderView.body.dispute);

    const posted = await moderator
      .post(`/disputes/${fixture.disputeId}/messages`)
      .send({ body: "Please provide a fresh screenshot of the login error." });
    expect(posted.status).toBe(201);
    expect(posted.body.message).toMatchObject({
      disputeId: fixture.disputeId,
      authorId: fixture.moderatorId,
      authorRole: "moderator"
    });
    expectNoModerationFields(posted.body.message);

    const messages = await moderator.get(
      `/disputes/${fixture.disputeId}/messages`
    );
    expect(messages.status).toBe(200);
    expect(messages.body.messages).toHaveLength(1);
    expectNoModerationFields(messages.body.messages[0]);

    const deniedResolution = await moderator
      .post(`/disputes/${fixture.disputeId}/resolve`)
      .send({ decision: "refund", adminNote: "Moderator must not resolve" });
    expect(deniedResolution.status).toBe(403);

    const deniedHide = await moderator
      .post(
        `/disputes/${fixture.disputeId}/messages/${posted.body.message.id}/hide`
      )
      .send({ reason: "Moderator must not hide evidence" });
    expect(deniedHide.status).toBe(403);

    const adminDetail = await admin.get(`/disputes/${fixture.disputeId}`);
    expect(adminDetail.status).toBe(200);
    expect(adminDetail.body.dispute).toMatchObject({
      resolutionOperationId: fixture.operationId,
      resolvingStartedAt: fixture.resolvingStartedAt.toISOString(),
      resolutionAttempts: 2,
      lastResolutionError: "internal retry detail",
      adminId: fixture.adminId,
      adminNote: "private admin note"
    });
    expect(typeof adminDetail.body.dispute.amountCents).toBe("string");
    expect(adminDetail.body.dispute).not.toHaveProperty("conversationId");

    const adminList = await admin.get("/disputes");
    expect(adminList.status).toBe(200);
    expect(adminList.body.disputes[0]).toMatchObject({
      resolutionOperationId: fixture.operationId,
      resolvingStartedAt: fixture.resolvingStartedAt.toISOString(),
      resolutionAttempts: 2,
      lastResolutionError: "internal retry detail",
      adminId: fixture.adminId,
      adminNote: "private admin note"
    });
    expect(typeof adminList.body.disputes[0].amountCents).toBe("string");

    const adminOrderView = await admin.get(
      `/disputes/orders/${fixture.orderId}/dispute`
    );
    expect(adminOrderView.status).toBe(200);
    expect(adminOrderView.body.dispute).toMatchObject({
      resolutionOperationId: fixture.operationId,
      resolvingStartedAt: fixture.resolvingStartedAt.toISOString(),
      resolutionAttempts: 2,
      lastResolutionError: "internal retry detail",
      adminId: fixture.adminId,
      adminNote: "private admin note"
    });

    const hidden = await admin
      .post(
        `/disputes/${fixture.disputeId}/messages/${posted.body.message.id}/hide`
      )
      .send({ reason: "Contains sensitive credentials" });
    expect(hidden.status).toBe(200);
    expect(hidden.body.message).toMatchObject({
      hiddenBy: fixture.adminId,
      moderationReason: "Contains sensitive credentials"
    });

    const afterHide = await moderator.get(
      `/disputes/${fixture.disputeId}/messages`
    );
    expect(afterHide.status).toBe(200);
    expect(afterHide.body.messages).toEqual([]);
  });

  it("keeps unrelated users outside the dispute", async () => {
    const fixture = await seedDispute();
    const outsider = await agentFor(fixture.outsiderId, "user");

    expect(
      (
        await outsider.get(
          `/disputes/orders/${fixture.orderId}/dispute`
        )
      ).status
    ).toBe(404);
    expect(
      (await outsider.get(`/disputes/${fixture.disputeId}/messages`)).status
    ).toBe(403);
    expect(
      (
        await outsider
          .post(`/disputes/${fixture.disputeId}/messages`)
          .send({ body: "I must not be able to join this dispute." })
      ).status
    ).toBe(403);
  });
});
