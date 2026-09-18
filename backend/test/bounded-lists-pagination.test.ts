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

async function userAgent(userId: string, role: "user" | "admin" = "user") {
  const session = await issueSession(userId, role);
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
  const notifications = await pool.query<{ id: string }>(
    `insert into notifications(user_id, type, title, body, created_at)
     select $1, 'pagination_test', 'Notification ' || n, 'Body ' || n,
            coalesce($3::timestamptz, now())
     from generate_series(1, $2::int) as n
     returning id`,
    [ownerId, count, createdAt ?? null]
  );
  const tickets = await pool.query<{ id: string }>(
    `insert into support_tickets(user_id, subject, body, created_at)
     select $1, 'Support ticket ' || n, 'Support ticket body ' || n,
            coalesce($3::timestamptz, now())
     from generate_series(1, $2::int) as n
     returning id`,
    [ownerId, count, createdAt ?? null]
  );

  return {
    targetIds,
    productIds,
    reportIds: reports.rows.map((row) => row.id),
    notificationIds: notifications.rows.map((row) => row.id),
    ticketIds: tickets.rows.map((row) => row.id)
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
  },
  {
    path: "/notifications",
    key: "notifications"
  },
  {
    path: "/support/tickets/me",
    key: "tickets"
  }
] as const;

describe("previously unbounded authenticated lists", () => {
  it("enforces max limits and rejects malformed cursors on every contract", async () => {
    const ownerId = await createUser();
    await seedOwnedLists(ownerId, 26);
    const agent = await userAgent(ownerId);

    for (const list of boundedLists) {
      const response = await agent.get(`${list.path}?limit=25`);
      expect(response.status, `${list.path}: ${response.text}`).toBe(200);
      expect(response.body[list.key], list.path).toHaveLength(25);
      expect(response.body.nextCursor, list.path).toEqual(expect.any(String));

      const tooLarge = await agent.get(`${list.path}?limit=101`);
      expect(tooLarge.status, list.path).toBe(400);

      const malformed = await agent.get(`${list.path}?cursor=not-a-real-cursor`);
      expect(malformed.status, list.path).toBe(400);
    }

    const adminId = await createUser("admin");
    const admin = await userAgent(adminId, "admin");
    const adminTickets = await admin.get("/support/admin/tickets?limit=25");
    expect(adminTickets.status, adminTickets.text).toBe(200);
    expect(adminTickets.body.tickets).toHaveLength(25);
    expect(adminTickets.body.nextCursor).toEqual(expect.any(String));
    expect((await admin.get("/support/admin/tickets?limit=301")).status).toBe(400);
    expect((await admin.get("/support/admin/tickets?cursor=not-a-real-cursor")).status).toBe(400);

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
    const outsiderNotification = await pool.query<{ id: string }>(
      `insert into notifications(user_id, type, title, created_at)
       values ($1, 'pagination_test', 'Foreign notification', $2)
       returning id`,
      [outsiderId, sharedCreatedAt]
    );
    const outsiderTicket = await pool.query<{ id: string }>(
      `insert into support_tickets(user_id, subject, body, created_at)
       values ($1, 'Foreign ticket', 'Foreign ticket body', $2)
       returning id`,
      [outsiderId, sharedCreatedAt]
    );

    const expectedByPath: Record<string, string[]> = {
      "/marketplace/favorites/ids": own.productIds,
      "/marketplace/favorites": own.productIds,
      "/marketplace/seller/products": own.productIds,
      "/users/me/seller-favorites": own.targetIds,
      "/users/me/blocked": own.targetIds,
      "/reports/my": own.reportIds,
      "/notifications": own.notificationIds,
      "/support/tickets/me": own.ticketIds
    };
    const foreignByPath: Record<string, string> = {
      "/marketplace/favorites/ids": outsiderProductId,
      "/marketplace/favorites": outsiderProductId,
      "/marketplace/seller/products": outsiderProductId,
      "/users/me/seller-favorites": outsiderTargetId,
      "/users/me/blocked": outsiderTargetId,
      "/reports/my": outsiderReport.rows[0].id,
      "/notifications": outsiderNotification.rows[0].id,
      "/support/tickets/me": outsiderTicket.rows[0].id
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

  it("preserves sub-millisecond PostgreSQL cursors without gaps or duplicates", async () => {
    const ownerId = await createUser();
    const firstTimestamp = "2026-06-01T12:00:00.000900Z";
    const secondTimestamp = "2026-06-01T12:00:00.000800Z";
    const inserted = await pool.query<{ id: string }>(
      `insert into notifications(user_id, type, title, created_at)
       values
         ($1, 'pagination_test', 'First A', $2),
         ($1, 'pagination_test', 'First B', $2),
         ($1, 'pagination_test', 'Second A', $3),
         ($1, 'pagination_test', 'Second B', $3)
       returning id`,
      [ownerId, firstTimestamp, secondTimestamp]
    );
    const agent = await userAgent(ownerId);

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const suffix = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
      const response = await agent.get(`/notifications?limit=1${suffix}`);
      expect(response.status, response.text).toBe(200);
      expect(response.body.notifications[0]).not.toHaveProperty("cursorCreatedAt");
      seen.push(...response.body.notifications.map((row: { id: string }) => row.id));
      cursor = response.body.nextCursor;
    } while (cursor);

    expect(new Set(seen).size).toBe(inserted.rows.length);
    expect([...seen].sort()).toEqual(inserted.rows.map((row) => row.id).sort());
  });
});

describe("public seller bounded snapshots", () => {
  it("uses a UUID tie-breaker for the 24-product snapshot", async () => {
    const sellerId = await createUser();
    const productIds: string[] = [];
    for (let index = 0; index < 25; index += 1) {
      productIds.push(await createProduct(sellerId));
    }
    await pool.query(
      `update products set created_at = '2026-06-02T12:00:00Z' where id = any($1::uuid[])`,
      [productIds]
    );

    const response = await request(app).get(`/users/${sellerId}`);

    expect(response.status, response.text).toBe(200);
    expect(response.body.products.map((row: { id: string }) => row.id)).toEqual(
      [...productIds].sort().reverse().slice(0, 24)
    );
  });

  it("hides catalog-bound products when any catalog ancestor is inactive", async () => {
    const sellerId = await createUser();
    const followerId = await createUser();
    await pool.query(`insert into seller_favorites(user_id, seller_id) values ($1, $2)`, [followerId, sellerId]);
    const follower = await userAgent(followerId);
    const expectFavoriteListingCount = async (expected: number) => {
      const response = await follower.get("/users/me/seller-favorites");
      expect(response.status, response.text).toBe(200);
      expect(response.body.sellers.find((row: { id: string }) => row.id === sellerId)?.activeListings).toBe(expected);
    };
    const productId = await createProduct(sellerId);
    const category = await pool.query<{ id: string }>(
      `select category_id as id from products where id = $1`,
      [productId]
    );
    const group = await pool.query<{ id: string }>(
      `insert into catalog_groups(slug, name, status)
       values ('seller-snapshot-group-' || gen_random_uuid()::text, 'Seller snapshot group', 'active')
       returning id`
    );
    const item = await pool.query<{ id: string }>(
      `insert into games(group_id, slug, name, status)
       values ($1, 'seller-snapshot-item-' || gen_random_uuid()::text, 'Seller snapshot item', 'active')
       returning id`,
      [group.rows[0].id]
    );
    const section = await pool.query<{ id: string }>(
      `insert into game_sections(game_id, category_id, slug, name, status)
       values ($1, $2, 'seller-snapshot-section', 'Seller snapshot section', 'active')
       returning id`,
      [item.rows[0].id, category.rows[0].id]
    );
    await pool.query(
      `insert into catalog_section_schemas(section_id, version, schema, status, published_at)
       values ($1, 1, '{"fields":[]}', 'active', now())`,
      [section.rows[0].id]
    );
    await pool.query(`update game_sections set current_schema_version = 1 where id = $1`, [section.rows[0].id]);
    await pool.query(
      `update products set game_id = $2, section_id = $3, schema_version = 1 where id = $1`,
      [productId, item.rows[0].id, section.rows[0].id]
    );

    const visible = await request(app).get(`/users/${sellerId}`);
    expect(visible.status, visible.text).toBe(200);
    expect(visible.body.products.map((row: { id: string }) => row.id)).toContain(productId);
    expect(visible.body.stats.activeListings).toBe(1);
    await expectFavoriteListingCount(1);

    await pool.query(`update catalog_groups set status = 'hidden' where id = $1`, [group.rows[0].id]);
    const hiddenByGroup = await request(app).get(`/users/${sellerId}`);
    expect(hiddenByGroup.status, hiddenByGroup.text).toBe(200);
    expect(hiddenByGroup.body.products.map((row: { id: string }) => row.id)).not.toContain(productId);
    expect(hiddenByGroup.body.stats.activeListings).toBe(0);
    await expectFavoriteListingCount(0);

    await pool.query(`update catalog_groups set status = 'active' where id = $1`, [group.rows[0].id]);
    await pool.query(`update games set status = 'hidden' where id = $1`, [item.rows[0].id]);
    const hiddenByItem = await request(app).get(`/users/${sellerId}`);
    expect(hiddenByItem.status, hiddenByItem.text).toBe(200);
    expect(hiddenByItem.body.products.map((row: { id: string }) => row.id)).not.toContain(productId);
    expect(hiddenByItem.body.stats.activeListings).toBe(0);
    await expectFavoriteListingCount(0);

    await pool.query(`update games set status = 'active' where id = $1`, [item.rows[0].id]);
    await pool.query(`update game_sections set status = 'hidden' where id = $1`, [section.rows[0].id]);
    const hiddenBySection = await request(app).get(`/users/${sellerId}`);
    expect(hiddenBySection.status, hiddenBySection.text).toBe(200);
    expect(hiddenBySection.body.products.map((row: { id: string }) => row.id)).not.toContain(productId);
    expect(hiddenBySection.body.stats.activeListings).toBe(0);
    await expectFavoriteListingCount(0);

    await pool.query(`update game_sections set status = 'active' where id = $1`, [section.rows[0].id]);
    const restored = await request(app).get(`/users/${sellerId}`);
    expect(restored.status, restored.text).toBe(200);
    expect(restored.body.stats.activeListings).toBe(1);
    await expectFavoriteListingCount(1);
  });
});
