import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { getRedis } from "../src/common/redis.js";
import { issueSession } from "../src/modules/auth/session.service.js";
import { decodeCursor, encodeCursor } from "../src/common/pagination.js";
import { closeDb, createConversation, createOrder, createProduct, createUser, resetDb } from "./fixtures.js";

const app = createApp();

beforeEach(resetDb);
afterAll(async () => {
  await getRedis()?.quit();
  await closeDb();
});

async function adminAgent() {
  const userId = await createUser("admin");
  return { userId, ...(await getAgent(userId, "admin")) };
}

async function getAgent(userId: string, role: "user" | "moderator" | "admin" = "user") {
  const session = await issueSession(userId, role);
  const cookie = [`access_token=${session.accessToken}`, `csrf_token=${session.csrfToken}`];
  return { get: (path: string) => request(app).get(path).set("Cookie", cookie) };
}

describe("cursor helper", () => {
  it("round-trips through encode/decode", () => {
    const createdAt = new Date("2026-01-05T10:00:00.000Z");
    const cursor = encodeCursor(createdAt, "11111111-1111-1111-1111-111111111111");
    const decoded = decodeCursor(cursor);
    expect(decoded.createdAt).toBe(createdAt.toISOString());
    expect(decoded.id).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("rejects a malformed cursor", () => {
    expect(() => decodeCursor("not-base64!!!")).toThrow();
    expect(() => decodeCursor(Buffer.from("no-separator-here").toString("base64url"))).toThrow();
    expect(() => decodeCursor(Buffer.from("not-a-date|abc").toString("base64url"))).toThrow();
    expect(() => decodeCursor(Buffer.from("2026-01-01T00:00:00.000Z|not-a-uuid").toString("base64url"))).toThrow();
  });
});

describe("GET /orders pagination", () => {
  it("uses the id tiebreaker without leaking another participant's orders", async () => {
    const buyer = await createUser();
    const seller = await createUser();
    const product = await createProduct(seller);
    const sharedCreatedAt = "2026-03-01T00:00:00.000Z";
    const expected: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const orderId = await createOrder(buyer, seller, product);
      expected.push(orderId);
      await pool.query(`update orders set created_at = $2 where id = $1`, [orderId, sharedCreatedAt]);
    }

    const otherBuyer = await createUser();
    const otherSeller = await createUser();
    const otherProduct = await createProduct(otherSeller);
    const foreignOrder = await createOrder(otherBuyer, otherSeller, otherProduct);
    await pool.query(`update orders set created_at = $2 where id = $1`, [foreignOrder, sharedCreatedAt]);

    const buyerAgent = await getAgent(buyer);
    const tooLarge = await buyerAgent.get("/orders?limit=101");
    expect(tooLarge.status).toBe(400);

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const suffix = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
      const response = await buyerAgent.get(`/orders?role=buyer&limit=2${suffix}`);
      expect(response.status).toBe(200);
      seen.push(...response.body.orders.map((order: { id: string }) => order.id));
      cursor = response.body.nextCursor;
    } while (cursor);

    expect(new Set(seen).size).toBe(expected.length);
    expect(seen.sort()).toEqual(expected.sort());
    expect(seen).not.toContain(foreignOrder);
  });
});

describe("chat list pagination", () => {
  it("pages conversations and tied messages with stable cursors and ownership checks", async () => {
    const buyer = await createUser();
    const outsider = await createUser();
    const sharedCreatedAt = "2026-03-02T00:00:00.000Z";
    const conversationIds: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const peer = await createUser();
      const conversationId = await createConversation(buyer, peer);
      conversationIds.push(conversationId);
      await pool.query(`update conversations set created_at = $2 where id = $1`, [conversationId, sharedCreatedAt]);
    }

    const buyerAgent = await getAgent(buyer);
    const firstConversations = await buyerAgent.get("/chat/conversations?limit=2");
    expect(firstConversations.status).toBe(200);
    const secondConversations = await buyerAgent.get(
      `/chat/conversations?limit=2&cursor=${encodeURIComponent(firstConversations.body.nextCursor)}`
    );
    const seenConversations = [
      ...firstConversations.body.conversations,
      ...secondConversations.body.conversations
    ].map((conversation: { id: string }) => conversation.id);
    expect(new Set(seenConversations).size).toBe(4);
    expect(seenConversations.sort()).toEqual(conversationIds.sort());

    const targetConversation = conversationIds[0];
    const messageIds: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const inserted = await pool.query<{ id: string }>(
        `insert into messages(conversation_id, sender_id, body, created_at)
         values ($1, $2, $3, $4)
         returning id`,
        [targetConversation, buyer, `Message ${index}`, sharedCreatedAt]
      );
      messageIds.push(inserted.rows[0].id);
    }

    const seenMessages: string[] = [];
    let cursor: string | null = null;
    do {
      const suffix = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
      const response = await buyerAgent.get(
        `/chat/conversations/${targetConversation}/messages?limit=2${suffix}`
      );
      expect(response.status).toBe(200);
      seenMessages.push(...response.body.messages.map((message: { id: string }) => message.id));
      cursor = response.body.nextCursor;
    } while (cursor);
    expect(new Set(seenMessages).size).toBe(messageIds.length);
    expect(seenMessages.sort()).toEqual(messageIds.sort());

    expect((await buyerAgent.get(`/chat/conversations/${targetConversation}/messages?limit=201`)).status).toBe(400);
    const outsiderAgent = await getAgent(outsider);
    expect((await outsiderAgent.get(`/chat/conversations/${targetConversation}/messages`)).status).toBe(403);
  });
});

describe("dispute message pagination", () => {
  it("bounds embedded detail messages, exposes continuation, and preserves participant ownership", async () => {
    const buyer = await createUser();
    const seller = await createUser();
    const outsider = await createUser();
    const product = await createProduct(seller);
    const orderId = await createOrder(buyer, seller, product, { status: "disputed" });
    const dispute = await pool.query<{ id: string }>(
      `insert into disputes(order_id, opened_by, reason)
       values ($1, $2, 'A sufficiently detailed dispute reason')
       returning id`,
      [orderId, buyer]
    );
    const disputeId = dispute.rows[0].id;
    const sharedCreatedAt = "2026-03-03T00:00:00.000Z";
    const inserted = await pool.query<{ id: string }>(
      `insert into dispute_messages(dispute_id, author_id, body, created_at)
       select $1, $2, 'Evidence message ' || n, $3::timestamptz
       from generate_series(1, 51) as n
       returning id`,
      [disputeId, buyer, sharedCreatedAt]
    );

    const buyerAgent = await getAgent(buyer);
    const detail = await buyerAgent.get(`/disputes/orders/${orderId}/dispute`);
    expect(detail.status).toBe(200);
    expect(detail.body.messages).toHaveLength(50);
    expect(detail.body.messageNextCursor).toEqual(expect.any(String));

    const remainder = await buyerAgent.get(
      `/disputes/${disputeId}/messages?limit=50&cursor=${encodeURIComponent(detail.body.messageNextCursor)}`
    );
    expect(remainder.status).toBe(200);
    expect(remainder.body.messages).toHaveLength(1);
    const allIds = [...detail.body.messages, ...remainder.body.messages].map(
      (message: { id: string }) => message.id
    );
    expect(new Set(allIds).size).toBe(inserted.rows.length);

    expect((await buyerAgent.get(`/disputes/${disputeId}/messages?limit=101`)).status).toBe(400);
    const outsiderAgent = await getAgent(outsider);
    expect((await outsiderAgent.get(`/disputes/${disputeId}/messages`)).status).toBe(403);

    const admin = await adminAgent();
    const adminDetail = await admin.get(`/disputes/${disputeId}`);
    expect(adminDetail.status).toBe(200);
    expect(adminDetail.body).toHaveProperty("messageNextCursor");
    expect(adminDetail.body).toHaveProperty("disputeMessageNextCursor");
  });
});

describe("admin list bounds", () => {
  it("enforces maximums across the paginated admin list contracts", async () => {
    const admin = await adminAgent();
    const paths = [
      "/admin/users?limit=101",
      "/admin/media?limit=101",
      "/admin/listings?limit=101",
      "/admin/orders/pending?limit=101",
      "/admin/transactions?limit=101",
      "/admin/ledger?limit=101",
      "/admin/reconciliation?limit=101",
      "/admin/payouts?limit=101",
      "/admin/reports?limit=101",
      "/admin/reconciliation/export?limit=1001"
    ];
    for (const path of paths) {
      const response = await admin.get(path);
      expect(response.status, path).toBe(400);
    }
  });

  it("executes every paginated admin query successfully", async () => {
    const admin = await adminAgent();
    const paths = [
      "/admin/users?limit=2",
      "/admin/media?limit=2",
      "/admin/listings?limit=2",
      "/admin/orders/pending?limit=2",
      "/admin/transactions?limit=2",
      "/admin/ledger?limit=2",
      "/admin/reconciliation?limit=2",
      "/admin/payouts?limit=2",
      "/admin/reports?limit=2",
      "/admin/reconciliation/export?limit=2"
    ];
    for (const path of paths) {
      const response = await admin.get(path);
      expect(response.status, `${path}: ${response.text}`).toBe(200);
    }
  });

  it("stable-sorts tied user rows and traverses them without duplicates", async () => {
    const admin = await adminAgent();
    const sharedCreatedAt = "2026-03-04T00:00:00.000Z";
    const expected: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const userId = await createUser();
      expected.push(userId);
      await pool.query(`update users set created_at = $2 where id = $1`, [userId, sharedCreatedAt]);
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page += 1) {
      const suffix = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
      const response = await admin.get(`/admin/users?limit=2${suffix}`);
      expect(response.status).toBe(200);
      seen.push(...response.body.users.map((user: { id: string }) => user.id));
      cursor = response.body.nextCursor;
      if (!cursor) break;
    }
    expect(new Set(seen).size).toBe(seen.length);
    for (const id of expected) expect(seen).toContain(id);
  });

  it("keeps report priority first and uses a total order across pages", async () => {
    const admin = await adminAgent();
    const sharedCreatedAt = "2026-03-05T00:00:00.000Z";
    const reportIds: string[] = [];
    let highPriorityId = "";
    for (let index = 0; index < 5; index += 1) {
      const reporter = await createUser();
      const reported = await createUser();
      const priority = index === 2 ? "high" : "normal";
      const inserted = await pool.query<{ id: string }>(
        `insert into user_reports(reporter_id, reported_user_id, reason, priority, created_at)
         values ($1, $2, 'other', $3, $4)
         returning id`,
        [reporter, reported, priority, sharedCreatedAt]
      );
      reportIds.push(inserted.rows[0].id);
      if (priority === "high") highPriorityId = inserted.rows[0].id;
    }

    const seen: string[] = [];
    for (let page = 1; page <= 3; page += 1) {
      const response = await admin.get(`/admin/reports?limit=2&page=${page}`);
      expect(response.status).toBe(200);
      seen.push(...response.body.reports.map((report: { id: string }) => report.id));
    }
    expect(seen[0]).toBe(highPriorityId);
    expect(new Set(seen).size).toBe(reportIds.length);
    expect(seen.sort()).toEqual(reportIds.sort());
  });
});

describe("GET /disputes pagination (previously unbounded)", () => {
  async function seedDispute(index: number, createdAt: string) {
    const buyer = await createUser();
    const seller = await createUser();
    const product = await createProduct(seller);
    const orderId = await createOrder(buyer, seller, product, { status: "disputed" });
    const dispute = await pool.query<{ id: string }>(
      `insert into disputes(order_id, opened_by, reason, created_at)
       values ($1, $2, $3, $4)
       returning id`,
      [orderId, buyer, `Dispute reason number ${index}`, createdAt]
    );
    return dispute.rows[0].id;
  }

  it("enforces the maximum limit", async () => {
    const admin = await adminAgent();
    const response = await admin.get("/disputes?limit=1000");
    expect(response.status).toBe(400);
  });

  it("paginates through more rows than the default page size without gaps or duplicates", async () => {
    const admin = await adminAgent();
    const total = 7;
    const ids: string[] = [];
    // All rows share one timestamp on purpose - the id tiebreaker must still produce a
    // stable, gap-free, duplicate-free traversal.
    const sharedCreatedAt = "2026-02-01T00:00:00.000Z";
    for (let i = 0; i < total; i += 1) {
      ids.push(await seedDispute(i, sharedCreatedAt));
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < total; page += 1) {
      const url: string = cursor ? `/disputes?limit=3&cursor=${encodeURIComponent(cursor)}` : "/disputes?limit=3";
      const response = await admin.get(url);
      expect(response.status).toBe(200);
      for (const row of response.body.disputes) seen.push(row.id);
      cursor = response.body.nextCursor;
      if (!cursor) break;
    }

    expect(new Set(seen).size).toBe(total);
    expect(seen.sort()).toEqual([...ids].sort());
  });

  it("returns a null nextCursor once the last page is short", async () => {
    const admin = await adminAgent();
    await seedDispute(0, "2026-02-02T00:00:00.000Z");
    const response = await admin.get("/disputes?limit=25");
    expect(response.status).toBe(200);
    expect(response.body.nextCursor).toBeNull();
  });
});

describe("GET /admin/audit pagination", () => {
  async function seedAuditRow(action: string, createdAt: string) {
    await pool.query(
      `insert into audit_logs(trace_id, method, path, endpoint, status_code, action, metadata, created_at)
       values ($1, 'GET', '/test', '/test', 200, $2, '{}'::jsonb, $3)`,
      [randomUUID(), action, createdAt]
    );
  }

  it("enforces the maximum limit", async () => {
    const admin = await adminAgent();
    const response = await admin.get("/admin/audit?limit=99999");
    expect(response.status).toBe(400);
  });

  it("stable-sorts and pages through tied timestamps without loss", async () => {
    const admin = await adminAgent();
    const sharedCreatedAt = "2026-02-03T00:00:00.000Z";
    for (let i = 0; i < 6; i += 1) {
      await seedAuditRow(`test_action_${i}`, sharedCreatedAt);
    }

    const firstPage = await admin.get("/admin/audit?limit=4");
    expect(firstPage.status).toBe(200);
    expect(firstPage.body.auditLogs).toHaveLength(4);
    expect(firstPage.body.nextCursor).not.toBeNull();

    const secondPage = await admin.get(
      `/admin/audit?limit=4&cursor=${encodeURIComponent(firstPage.body.nextCursor)}`
    );
    expect(secondPage.status).toBe(200);
    const firstIds = new Set(firstPage.body.auditLogs.map((row: { id: string }) => row.id));
    const secondIds = secondPage.body.auditLogs.map((row: { id: string }) => row.id);
    for (const id of secondIds) expect(firstIds.has(id)).toBe(false);
    expect(secondPage.body.auditLogs.length).toBeGreaterThan(0);
  });

  it("rejects a garbage cursor with a client error, not a 500", async () => {
    const admin = await adminAgent();
    const response = await admin.get("/admin/audit?cursor=not-a-real-cursor");
    expect(response.status).toBe(400);
  });
});
