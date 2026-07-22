import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { getRedis } from "../src/common/redis.js";
import { issueSession } from "../src/modules/auth/session.service.js";
import { decodeCursor, encodeCursor } from "../src/common/pagination.js";
import { closeDb, createOrder, createProduct, createUser, resetDb } from "./fixtures.js";

const app = createApp();

beforeEach(resetDb);
afterAll(async () => {
  await getRedis()?.quit();
  await closeDb();
});

async function adminAgent() {
  const userId = await createUser("admin");
  const session = await issueSession(userId, "admin");
  const cookie = [`access_token=${session.accessToken}`, `csrf_token=${session.csrfToken}`];
  return { userId, get: (path: string) => request(app).get(path).set("Cookie", cookie) };
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
