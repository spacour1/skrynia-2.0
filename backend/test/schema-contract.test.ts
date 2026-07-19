import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { getRedis } from "../src/common/redis.js";
import { issueSession } from "../src/modules/auth/session.service.js";
import { createSystemMessage } from "../src/modules/chat/chat.service.js";
import { closeDb, createUser, resetDb } from "./fixtures.js";

/**
 * Schema-to-code contract smoke (production hardening, stage 1). The test database is
 * built exclusively by the repository migrations (no manual SQL), so every assertion here
 * doubles as a clean-database smoke test: if a migration stops producing the schema the
 * application code relies on, this file fails before any feature test does.
 */

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
  return {
    userId,
    patch: (path: string) => request(app).patch(path).set("Cookie", cookie).set("X-CSRF-Token", session.csrfToken)
  };
}

describe("roles contract", () => {
  it("allows only user/moderator/admin at the database level", async () => {
    await expect(pool.query(`insert into users(email, display_name, role) values ($1, 'X', 'seller')`, [`${randomUUID()}@t.local`])).rejects.toThrow(
      /users_role_check/
    );
  });

  it("assigns the moderator role through the admin API", async () => {
    const admin = await adminAgent();
    const target = await createUser("user");
    const response = await admin.patch(`/admin/users/${target}`).send({ role: "moderator" });
    expect(response.status).toBe(200);
    expect(response.body.user.role).toBe("moderator");
    const row = await pool.query<{ role: string }>(`select role from users where id = $1`, [target]);
    expect(row.rows[0].role).toBe("moderator");
  });
});

describe("messages contract", () => {
  async function createConversation() {
    const buyer = await createUser("user");
    const seller = await createUser("user");
    const result = await pool.query<{ id: string }>(
      `insert into conversations(buyer_id, seller_id) values ($1, $2) returning id`,
      [buyer, seller]
    );
    return { conversationId: result.rows[0].id, buyer };
  }

  it("stores system messages without a sender and returns them with kind/system_type/metadata", async () => {
    const { conversationId } = await createConversation();
    const message = await createSystemMessage({
      conversationId,
      type: "order_started",
      bodyKey: "system.orderStarted",
      metadata: { orderId: randomUUID() }
    });
    expect(message.kind).toBe("system");
    expect(message.senderId).toBeNull();
    expect(message.systemType).toBe("order_started");
    expect(message.metadata).toMatchObject({ bodyKey: "system.orderStarted" });
  });

  it("rejects a user message without a sender and a system message with a sender", async () => {
    const { conversationId, buyer } = await createConversation();
    await expect(
      pool.query(`insert into messages(conversation_id, sender_id, kind, body) values ($1, null, 'user', 'x')`, [conversationId])
    ).rejects.toThrow(/messages_sender_kind_check/);
    await expect(
      pool.query(`insert into messages(conversation_id, sender_id, kind, body) values ($1, $2, 'system', 'x')`, [conversationId, buyer])
    ).rejects.toThrow(/messages_sender_kind_check/);
  });
});

describe("catalog schema versions contract", () => {
  it("enforces at most one active schema version per section at the database level", async () => {
    const admin = await createUser("admin");
    const group = await pool.query<{ id: string }>(
      `insert into catalog_groups(slug, name, status) values ($1, 'G', 'active') returning id`,
      [`g-${randomUUID().slice(0, 8)}`]
    );
    const game = await pool.query<{ id: string }>(
      `insert into games(group_id, slug, name, status) values ($1, $2, 'Game', 'active') returning id`,
      [group.rows[0].id, `i-${randomUUID().slice(0, 8)}`]
    );
    const category = await pool.query<{ id: string }>(`select id from categories limit 1`);
    const section = await pool.query<{ id: string }>(
      `insert into game_sections(game_id, category_id, slug, name, status) values ($1, $2, $3, 'S', 'draft') returning id`,
      [game.rows[0].id, category.rows[0].id, `s-${randomUUID().slice(0, 8)}`]
    );

    await pool.query(
      `insert into catalog_section_schemas(section_id, version, schema, status, created_by) values ($1, 1, '{"fields":[]}', 'active', $2)`,
      [section.rows[0].id, admin]
    );
    await expect(
      pool.query(
        `insert into catalog_section_schemas(section_id, version, schema, status, created_by) values ($1, 2, '{"fields":[]}', 'active', $2)`,
        [section.rows[0].id, admin]
      )
    ).rejects.toThrow(/uq_catalog_section_schemas_one_active/);
  });
});

describe("product section/schema database contract", () => {
  it("requires every product section/schema pair to reference the same section schema", async () => {
    const admin = await createUser("admin");
    const seller = await createUser("user");
    const group = await pool.query<{ id: string }>(
      `insert into catalog_groups(slug, name, status) values ($1, 'G', 'active') returning id`,
      [`g-${randomUUID().slice(0, 8)}`]
    );
    const game = await pool.query<{ id: string }>(
      `insert into games(group_id, slug, name, status) values ($1, $2, 'Game', 'active') returning id`,
      [group.rows[0].id, `i-${randomUUID().slice(0, 8)}`]
    );
    const category = await pool.query<{ id: string }>(`select id from categories limit 1`);
    const section = await pool.query<{ id: string }>(
      `insert into game_sections(game_id, category_id, slug, name, status, current_schema_version)
       values ($1, $2, $3, 'S', 'active', 1) returning id`,
      [game.rows[0].id, category.rows[0].id, `s-${randomUUID().slice(0, 8)}`]
    );
    await pool.query(
      `insert into catalog_section_schemas(section_id, version, schema, status, created_by)
       values ($1, 1, '{"fields":[]}', 'active', $2)`,
      [section.rows[0].id, admin]
    );

    const baseValues = [
      seller,
      category.rows[0].id,
      game.rows[0].id,
      section.rows[0].id
    ];
    await expect(
      pool.query(
        `insert into products(
           seller_id, category_id, game_id, section_id, schema_version,
           title, description, price_cents, currency, stock, delivery_type
         )
         values ($1, $2, $3, $4, null, 'Missing version', 'A sufficiently long description', 1000, 'UAH', 1, 'manual')`,
        baseValues
      )
    ).rejects.toThrow(/products_section_schema_nullity_check/);

    await expect(
      pool.query(
        `insert into products(
           seller_id, category_id, game_id, section_id, schema_version,
           title, description, price_cents, currency, stock, delivery_type
         )
         values ($1, $2, $3, $4, 99, 'Missing pair', 'A sufficiently long description', 1000, 'UAH', 1, 'manual')`,
        baseValues
      )
    ).rejects.toThrow(/products_section_schema_fk/);
  });
});

describe("2FA schema contract", () => {
  it("stores TOTP methods and hashed one-time backup codes per user", async () => {
    const userId = await createUser("user");
    await pool.query(
      `insert into user_2fa_methods(
         user_id,
         active_secret_ciphertext,
         active_secret_iv,
         active_secret_auth_tag,
         active_secret_version,
         confirmed_at
       )
       values ($1, 'ciphertext', 'iv', 'auth-tag', 1, now())`,
      [userId]
    );
    await pool.query(`insert into user_2fa_backup_codes(user_id, code_hash) values ($1, 'hash-1'), ($1, 'hash-2')`, [userId]);

    const method = await pool.query<{
      legacy_secret: string | null;
      active_secret_ciphertext: string | null;
    }>(
      `select legacy_secret, active_secret_ciphertext
       from user_2fa_methods
       where user_id = $1`,
      [userId]
    );
    expect(method.rows[0]).toEqual({
      legacy_secret: null,
      active_secret_ciphertext: "ciphertext"
    });

    const codes = await pool.query<{ code_hash: string; used_at: string | null }>(
      `select code_hash, used_at from user_2fa_backup_codes where user_id = $1 order by code_hash`,
      [userId]
    );
    expect(codes.rows).toHaveLength(2);
    expect(codes.rows.every((row) => row.used_at === null)).toBe(true);

    // cascade cleanup when the user is deleted
    await pool.query(`delete from users where id = $1`, [userId]);
    const after = await pool.query(`select 1 from user_2fa_backup_codes where user_id = $1`, [userId]);
    expect(after.rows).toHaveLength(0);
  });
});
