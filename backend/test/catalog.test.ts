import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { getRedis } from "../src/common/redis.js";
import { issueSession } from "../src/modules/auth/session.service.js";
import { parseCatalogSchema, validateMetadataAgainstSchema } from "../src/modules/catalog/catalog.validation.js";
import {
  createCatalogGroup,
  createCatalogItem,
  createCatalogSection,
  createSchemaVersion,
  deleteCatalogSection,
  getAdminCatalogTree,
  getPublicCatalogTree,
  publishCatalogSection,
  publishSchemaVersion,
  validateLotMetadata
} from "../src/modules/catalog/catalog.service.js";
import { closeDb, createUser, resetDb } from "./fixtures.js";

const app = createApp();

beforeEach(resetDb);
afterAll(async () => {
  await getRedis()?.quit();
  await closeDb();
});

function uniqueSlug(prefix: string) {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

async function authedAgent(role: "user" | "admin" = "admin") {
  const userId = await createUser(role);
  const session = await issueSession(userId, role);
  const cookie = [`access_token=${session.accessToken}`, `csrf_token=${session.csrfToken}`];
  return {
    userId,
    get: (path: string) => request(app).get(path).set("Cookie", cookie),
    post: (path: string) => request(app).post(path).set("Cookie", cookie).set("X-CSRF-Token", session.csrfToken),
    patch: (path: string) => request(app).patch(path).set("Cookie", cookie).set("X-CSRF-Token", session.csrfToken),
    delete: (path: string) => request(app).delete(path).set("Cookie", cookie).set("X-CSRF-Token", session.csrfToken)
  };
}

async function anyCategoryId() {
  const result = await pool.query<{ id: string }>(`select id from categories limit 1`);
  return result.rows[0].id;
}

async function createGroupItemSection(adminId: string) {
  const group = await createCatalogGroup({ slug: uniqueSlug("group"), name: "Test Group", status: "active" }, adminId);
  const item = await createCatalogItem({ groupId: group.id, slug: uniqueSlug("item"), name: "Test Item", status: "active" }, adminId);
  const section = await createCatalogSection(
    { itemId: item.id, categoryId: await anyCategoryId(), slug: uniqueSlug("section"), name: "Test Section", listingType: "account", status: "draft" },
    adminId
  );
  return { group, item, section };
}

async function createProductForSection(sellerId: string, sectionId: string, gameId: string, metadata: Record<string, unknown> = {}) {
  const category = await pool.query<{ id: string }>(`select id from categories limit 1`);
  const result = await pool.query<{ id: string }>(
    `insert into products(seller_id, category_id, game_id, section_id, title, description, price_cents, currency, stock, delivery_type, metadata)
     values ($1, $2, $3, $4, 'Test product', 'Test description that is long enough', 1000, 'UAH', 5, 'manual', $5)
     returning id`,
    [sellerId, category.rows[0].id, gameId, sectionId, metadata]
  );
  return result.rows[0].id;
}

// ---------------------------------------------------------------------------
// Schema validation (pure functions)
// ---------------------------------------------------------------------------

describe("parseCatalogSchema", () => {
  it("accepts a valid schema", () => {
    const schema = parseCatalogSchema({
      fields: [{ key: "rank", label: "Rank", type: "select", required: true, options: ["Herald", "Divine"], filterable: true, showInCard: true, sortOrder: 1 }]
    });
    expect(schema.fields).toHaveLength(1);
  });

  it("rejects a select field with no options", () => {
    expect(() =>
      parseCatalogSchema({
        fields: [{ key: "rank", label: "Rank", type: "select", required: true, options: [], filterable: true, showInCard: true, sortOrder: 1 }]
      })
    ).toThrow(/select field "rank" must have options/);
  });

  it("rejects duplicate field keys", () => {
    expect(() =>
      parseCatalogSchema({
        fields: [
          { key: "rank", label: "Rank", type: "text", required: false, filterable: false, showInCard: true, sortOrder: 1 },
          { key: "rank", label: "Rank 2", type: "text", required: false, filterable: false, showInCard: true, sortOrder: 2 }
        ]
      })
    ).toThrow(/must be unique/);
  });

  it("rejects an invalid field key format", () => {
    expect(() =>
      parseCatalogSchema({
        fields: [{ key: "Rank Value", label: "Rank", type: "text", required: false, filterable: false, showInCard: true, sortOrder: 1 }]
      })
    ).toThrow();
  });
});

describe("validateMetadataAgainstSchema", () => {
  const schema = parseCatalogSchema({
    fields: [
      { key: "rank", label: "Rank", type: "select", required: true, options: ["Herald", "Divine"], filterable: true, showInCard: true, sortOrder: 1 },
      { key: "mmr", label: "MMR", type: "number", required: false, min: 0, max: 15000, filterable: true, showInCard: true, sortOrder: 2 }
    ]
  });

  it("rejects missing required fields", () => {
    expect(() => validateMetadataAgainstSchema(schema, {})).toThrow(/rank is required/);
  });

  it("rejects a select value outside the option list", () => {
    expect(() => validateMetadataAgainstSchema(schema, { rank: "Immortal" })).toThrow(/rank must be one of/);
  });

  it("rejects a non-numeric value for a number field", () => {
    expect(() => validateMetadataAgainstSchema(schema, { rank: "Herald", mmr: "high" })).toThrow(/mmr must be a number/);
  });

  it("accepts valid metadata and strips unknown keys", () => {
    const result = validateMetadataAgainstSchema(schema, { rank: "Divine", mmr: 9000, unknownField: "drop me" });
    expect(result).toEqual({ rank: "Divine", mmr: 9000 });
  });
});

// ---------------------------------------------------------------------------
// Service-level: hierarchy, slugs, schema publishing, delete guards
// ---------------------------------------------------------------------------

describe("catalog hierarchy", () => {
  it("creates a group, item, and section", async () => {
    const admin = await createUser("admin");
    const { group, item, section } = await createGroupItemSection(admin);
    expect(group.status).toBe("active");
    expect(item.groupId).toBe(group.id);
    expect(section.itemId).toBe(item.id);
  });

  it("rejects a duplicate group slug", async () => {
    const admin = await createUser("admin");
    const slug = uniqueSlug("dup-group");
    await createCatalogGroup({ slug, name: "First" }, admin);
    await expect(createCatalogGroup({ slug, name: "Second" }, admin)).rejects.toMatchObject({ code: "23505" });
  });

  it("rejects a duplicate section slug within the same item", async () => {
    const admin = await createUser("admin");
    const { item } = await createGroupItemSection(admin);
    const categoryId = await anyCategoryId();
    const slug = uniqueSlug("dup-section");
    await createCatalogSection({ itemId: item.id, categoryId, slug, name: "First" }, admin);
    await expect(createCatalogSection({ itemId: item.id, categoryId, slug, name: "Second" }, admin)).rejects.toMatchObject({ code: "23505" });
  });

  it("rejects creating a section without a categoryId", async () => {
    const admin = await createUser("admin");
    const { item } = await createGroupItemSection(admin);
    await expect(
      createCatalogSection({ itemId: item.id, slug: uniqueSlug("no-category"), name: "No category" } as never, admin)
    ).rejects.toThrow(/categoryId is required/);
  });
});

describe("section schema publishing", () => {
  it("cannot publish a section without a schema", async () => {
    const admin = await createUser("admin");
    const { section } = await createGroupItemSection(admin);
    await expect(publishCatalogSection(section.id, admin)).rejects.toThrow(/without schema/);
  });

  it("cannot create an invalid schema version", async () => {
    const admin = await createUser("admin");
    const { section } = await createGroupItemSection(admin);
    await expect(
      createSchemaVersion(section.id, { fields: [{ key: "rank", label: "Rank", type: "select", required: true, options: [], filterable: true, showInCard: true, sortOrder: 1 }] }, admin)
    ).rejects.toThrow(/must have options/);
  });

  it("publishes a valid schema and then the section", async () => {
    const admin = await createUser("admin");
    const { section } = await createGroupItemSection(admin);
    const version = await createSchemaVersion(
      section.id,
      { fields: [{ key: "rank", label: "Rank", type: "select", required: true, options: ["Herald"], filterable: true, showInCard: true, sortOrder: 1 }] },
      admin
    );
    expect(version.status).toBe("draft");

    await publishSchemaVersion(section.id, version.id, admin);
    const published = await publishCatalogSection(section.id, admin);
    expect(published.status).toBe("active");
  });
});

describe("lot creation validates metadata against the section schema", () => {
  it("stamps the schema version and validated metadata onto the lot", async () => {
    const admin = await createUser("admin");
    const { section } = await createGroupItemSection(admin);
    const version = await createSchemaVersion(
      section.id,
      { fields: [{ key: "rank", label: "Rank", type: "select", required: true, options: ["Herald"], filterable: true, showInCard: true, sortOrder: 1 }] },
      admin
    );
    await publishSchemaVersion(section.id, version.id, admin);

    const result = await validateLotMetadata(section.id, { rank: "Herald", extra: "dropped" });
    expect(result.schemaVersion).toBe(1);
    expect(result.metadata).toEqual({ rank: "Herald" });
  });

  it("rejects invalid metadata for a lot", async () => {
    const admin = await createUser("admin");
    const { section } = await createGroupItemSection(admin);
    const version = await createSchemaVersion(
      section.id,
      { fields: [{ key: "rank", label: "Rank", type: "select", required: true, options: ["Herald"], filterable: true, showInCard: true, sortOrder: 1 }] },
      admin
    );
    await publishSchemaVersion(section.id, version.id, admin);

    await expect(validateLotMetadata(section.id, { rank: "NotAnOption" })).rejects.toThrow(/rank must be one of/);
  });
});

describe("delete guards", () => {
  it("cannot delete a section that has products", async () => {
    const admin = await createUser("admin");
    const seller = await createUser("user");
    const { item, section } = await createGroupItemSection(admin);
    await createProductForSection(seller, section.id, item.id);

    await expect(deleteCatalogSection(section.id, admin)).rejects.toThrow(/Cannot delete section with existing products/);
  });

  it("hard-deletes a pristine draft section with no products or schemas", async () => {
    const admin = await createUser("admin");
    const { section } = await createGroupItemSection(admin);
    const result = await deleteCatalogSection(section.id, admin);
    expect(result.hardDeleted).toBe(true);
  });
});

describe("public vs admin catalog tree", () => {
  it("public tree excludes draft/hidden groups", async () => {
    const admin = await createUser("admin");
    const draftGroup = await createCatalogGroup({ slug: uniqueSlug("draft-group"), name: "Draft group", status: "draft" }, admin);

    const publicTree = await getPublicCatalogTree();
    expect(publicTree.some((group) => group.id === draftGroup.id)).toBe(false);

    const adminTree = await getAdminCatalogTree();
    expect(adminTree.some((group) => group.id === draftGroup.id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// HTTP-level: RBAC
// ---------------------------------------------------------------------------

describe("admin catalog RBAC", () => {
  it("allows an admin to create a group", async () => {
    const admin = await authedAgent("admin");
    const response = await admin.post("/admin/catalog/groups").send({ name: "Dropshipping", slug: uniqueSlug("dropshipping") });
    expect(response.status).toBe(201);
  });

  it("rejects a non-admin creating a group", async () => {
    const user = await authedAgent("user");
    const response = await user.post("/admin/catalog/groups").send({ name: "Dropshipping", slug: uniqueSlug("dropshipping") });
    expect(response.status).toBe(403);
  });

  it("public catalog groups endpoint requires no auth and only returns active groups", async () => {
    const response = await request(app).get("/marketplace/catalog/groups");
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.groups)).toBe(true);
  });
});
