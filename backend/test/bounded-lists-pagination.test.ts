import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { getRedis } from "../src/common/redis.js";
import { issueSession } from "../src/modules/auth/session.service.js";
import {
  closeDb,
  createConversation,
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

async function userAgent(userId: string) {
  const session = await issueSession(userId, "user");
  const cookie = [`access_token=${session.accessToken}`, `csrf_token=${session.csrfToken}`];
  return { get: (path: string) => request(app).get(path).set("Cookie", cookie) };
}

async function seedOwnedLists(ownerId: string, count: number, createdAt?: string) {
  const targetIds: string[] = [];
  const productIds: string[] = [];
  for (let index = 0; index < count; index += 1) {
    targetIds.push(await createUser());
    productIds.push(await createProduct(ownerId));
  }

  if (createdAt) {
    await pool.query(
      `update products set created_at = $2 where id = any($1::uuid[])`,
      [productIds, createdAt]
    );
  }

  await pool.query(
    `insert into product_favorites(user_id, product_id, created_at)
     select $1, id, coalesce($3::timestamptz, now())
     from unnest($2::uuid[]) as ids(id)`,
    [ownerId, productIds, createdAt ?? null]
  );
  await pool.query(
    `insert into seller_favorites(user_id, seller_id, created_at)
     select $1, id, coalesce($3::timestamptz, now())
     from unnest($2::uuid[]) as ids(id)`,
    [ownerId, targetIds, createdAt ?? null]
  );
  await pool.query(
    `insert into user_blocks(blocker_id, blocked_id, created_at)
     select $1, id, coalesce($3::timestamptz, now())
     from unnest($2::uuid[]) as ids(id)`,
    [ownerId, targetIds, createdAt ?? null]
  );
  const reports = await pool.query<{ id: string }>(
    `insert into user_reports(reporter_id, reported_user_id, reason, created_at)
     select $1, id, 'other', coalesce($3::timestamptz, now())
     from unnest($2::uuid[]) as ids(id)
     returning id`,
    [ownerId, targetIds, createdAt ?? null]
  );

  return {
    targetIds,
    productIds,
    reportIds: reports.rows.map((row) => row.id)
  };
}

const boundedLists = [
  {
    path: "/marketplace/favorites/ids",
    key: "productIds"
  },
  {
    path: "/marketplace/favorites",
    key: "products"
  },
  {
    path: "/marketplace/seller/products",
    key: "products"
  },
  {
    path: "/users/me/seller-favorites",
    key: "sellers"
  },
  {
    path: "/users/me/blocked",
    key: "blocked"
  },
  {
    path: "/reports/my",
    key: "reports"
  }
] as const;

describe("previously unbounded authenticated lists", () => {
  it("enforces default/max limits and rejects malformed cursors on every contract", async () => {
    const ownerId = await createUser();
    await seedOwnedLists(ownerId, 26);
    const agent = await userAgent(ownerId);

    for (const list of boundedLists) {
      const response = await agent.get(list.path);
      expect(response.status, `${list.path}: ${response.text}`).toBe(200);
      expect(response.body[list.key], list.path).toHaveLength(25);
      expect(response.body.nextCursor, list.path).toEqual(expect.any(String));

      const tooLarge = await agent.get(`${list.path}?limit=101`);
      expect(tooLarge.status, list.path).toBe(400);

      const malformed = await agent.get(`${list.path}?cursor=not-a-real-cursor`);
      expect(malformed.status, list.path).toBe(400);
    }

    const first = await agent.get("/marketplace/favorites/ids?limit=25");
    const second = await agent.get(
      `/marketplace/favorites/ids?limit=25&cursor=${encodeURIComponent(first.body.nextCursor)}`
    );
    expect(second.body.productIds).toHaveLength(1);
    expect(second.body.nextCursor).toBeNull();
  });

  it("uses the UUID tiebreaker without overlaps or cross-user records", async () => {
    const ownerId = await createUser();
    const sharedCreatedAt = "2026-06-01T12:00:00.000Z";
    const own = await seedOwnedLists(ownerId, 5, sharedCreatedAt);

    const conversationId = await createConversation(ownerId, own.targetIds[0]);
    const message = await pool.query<{ id: string }>(
      `insert into messages(conversation_id, sender_id, body, created_at)
       values ($1, $2, 'Reportable message', $3)
       returning id`,
      [conversationId, own.targetIds[0], sharedCreatedAt]
    );
    const messageReport = await pool.query<{ id: string }>(
      `insert into message_reports(
         reporter_id, message_id, conversation_id, reported_user_id, reason, created_at
       )
       values ($1, $2, $3, $4, 'spam', $5)
       returning id`,
      [ownerId, message.rows[0].id, conversationId, own.targetIds[0], sharedCreatedAt]
    );
    own.reportIds.push(messageReport.rows[0].id);

    const outsiderId = await createUser();
    const outsiderTargetId = await createUser();
    const outsiderProductId = await createProduct(outsiderId);
    await pool.query(`update products set created_at = $2 where id = $1`, [
      outsiderProductId,
      sharedCreatedAt
    ]);
    await pool.query(
      `insert into product_favorites(user_id, product_id, created_at) values ($1, $2, $3)`,
      [outsiderId, outsiderProductId, sharedCreatedAt]
    );
    await pool.query(
      `insert into seller_favorites(user_id, seller_id, created_at) values ($1, $2, $3)`,
      [outsiderId, outsiderTargetId, sharedCreatedAt]
    );
    await pool.query(
      `insert into user_blocks(blocker_id, blocked_id, created_at) values ($1, $2, $3)`,
      [outsiderId, outsiderTargetId, sharedCreatedAt]
    );
    const outsiderReport = await pool.query<{ id: string }>(
      `insert into user_reports(reporter_id, reported_user_id, reason, created_at)
       values ($1, $2, 'other', $3)
       returning id`,
      [outsiderId, outsiderTargetId, sharedCreatedAt]
    );

    const expectedByPath: Record<string, string[]> = {
      "/marketplace/favorites/ids": own.productIds,
      "/marketplace/favorites": own.productIds,
      "/marketplace/seller/products": own.productIds,
      "/users/me/seller-favorites": own.targetIds,
      "/users/me/blocked": own.targetIds,
      "/reports/my": own.reportIds
    };
    const foreignByPath: Record<string, string> = {
      "/marketplace/favorites/ids": outsiderProductId,
      "/marketplace/favorites": outsiderProductId,
      "/marketplace/seller/products": outsiderProductId,
      "/users/me/seller-favorites": outsiderTargetId,
      "/users/me/blocked": outsiderTargetId,
      "/reports/my": outsiderReport.rows[0].id
    };
    const agent = await userAgent(ownerId);

    for (const list of boundedLists) {
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const suffix = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
        const response = await agent.get(`${list.path}?limit=2${suffix}`);
        expect(response.status, `${list.path}: ${response.text}`).toBe(200);
        const rows = response.body[list.key] as Array<string | { id: string }>;
        seen.push(...rows.map((row) => (typeof row === "string" ? row : row.id)));
        cursor = response.body.nextCursor;
      } while (cursor);

      expect(new Set(seen).size, list.path).toBe(seen.length);
      expect([...seen].sort(), list.path).toEqual([...expectedByPath[list.path]].sort());
      expect(seen, list.path).not.toContain(foreignByPath[list.path]);
    }
  });
});
