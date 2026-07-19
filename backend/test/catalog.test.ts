import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { cacheDel, getRedis } from "../src/common/redis.js";
import { issueSession } from "../src/modules/auth/session.service.js";
import { parseCatalogSchema, validateMetadataAgainstSchema } from "../src/modules/catalog/catalog.validation.js";
import {
  createCatalogGroup,
  createCatalogItem,
  createCatalogSection,
  createSchemaVersion,
  deleteCatalogItem,
  deleteCatalogSection,
  getActiveSchemaForSection,
  getAdminCatalogTree,
  getPublicCatalogTree,
  publishCatalogSection,
  publishSchemaVersion,
  resolveActiveSectionChain,
  updateCatalogGroup,
  updateCatalogItem,
  updateCatalogSection,
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
  return agentForUser(userId, role);
}

async function agentForUser(userId: string, role: "user" | "moderator" | "admin") {
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
  const section = await pool.query<{ currentSchemaVersion: number | null }>(
    `select current_schema_version as "currentSchemaVersion" from game_sections where id = $1`,
    [sectionId]
  );
  if (section.rows[0]?.currentSchemaVersion === null) {
    await pool.query(
      `insert into catalog_section_schemas(section_id, version, schema, status)
       values ($1, 1, '{"fields":[]}', 'draft')
       on conflict (section_id, version) do nothing`,
      [sectionId]
    );
    await pool.query(`update game_sections set current_schema_version = 1 where id = $1`, [sectionId]);
  }
  const result = await pool.query<{ id: string }>(
    `insert into products(
       seller_id, category_id, game_id, section_id, title, description,
       price_cents, currency, stock, delivery_type, metadata, schema_version
     )
     values (
       $1, $2, $3, $4, 'Test product', 'Test description that is long enough',
       1000, 'UAH', 5, 'manual', $5,
       (select current_schema_version from game_sections where id = $4)
     )
     returning id`,
    [sellerId, category.rows[0].id, gameId, sectionId, metadata]
  );
  return result.rows[0].id;
}

// POST/PATCH /marketplace/products sit behind requireEmailVerified - the fixtures' bare
// createUser() leaves email_verified_at null, so HTTP-level product tests need a seller
// who has actually verified their email.
async function verifiedSeller() {
  const id = await createUser("user");
  await pool.query(`update users set email_verified_at = now() where id = $1`, [id]);
  return id;
}

/** Full active chain (group/item/section all active) with a published schema. */
async function activeSectionWithSchema(
  adminId: string,
  fields: Record<string, unknown>[],
  overrides: { allowedDeliveryTypes?: string[] } = {}
) {
  const { group, item, section } = await createGroupItemSection(adminId);
  if (overrides.allowedDeliveryTypes) {
    await updateCatalogSection(section.id, { allowedDeliveryTypes: overrides.allowedDeliveryTypes }, adminId);
  }
  const version = await createSchemaVersion(section.id, { fields }, adminId);
  await publishSchemaVersion(section.id, version.id, adminId);
  await publishCatalogSection(section.id, adminId);
  return { group, item, section };
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

// ---------------------------------------------------------------------------
// Active-chain gate: a lot can only attach to a section whose entire ancestry
// (group -> item -> section) is active AND which has a published (active) schema.
// ---------------------------------------------------------------------------

const cityField = { key: "city", label: "City", type: "text" as const, required: false, filterable: false, showInCard: true, sortOrder: 1 };

describe("resolveActiveSectionChain (active-chain gate)", () => {
  it("rejects when the section itself is still draft", async () => {
    const admin = await createUser("admin");
    const { section } = await activeSectionWithSchema(admin, [cityField]);
    await updateCatalogSection(section.id, { status: "draft" }, admin);
    await expect(resolveActiveSectionChain(section.id)).rejects.toThrow(/not available for creating lots/);
  });

  it("rejects when the section is hidden", async () => {
    const admin = await createUser("admin");
    const { section } = await activeSectionWithSchema(admin, [cityField]);
    await updateCatalogSection(section.id, { status: "hidden" }, admin);
    await expect(resolveActiveSectionChain(section.id)).rejects.toThrow(/not available for creating lots/);
  });

  it("rejects when the section is archived", async () => {
    const admin = await createUser("admin");
    const { section } = await activeSectionWithSchema(admin, [cityField]);
    await updateCatalogSection(section.id, { status: "archived" }, admin);
    await expect(resolveActiveSectionChain(section.id)).rejects.toThrow(/not available for creating lots/);
  });

  it("rejects when the parent item is hidden", async () => {
    const admin = await createUser("admin");
    const { item, section } = await activeSectionWithSchema(admin, [cityField]);
    await updateCatalogItem(item.id, { status: "hidden" }, admin);
    await expect(resolveActiveSectionChain(section.id)).rejects.toThrow(/not available for creating lots/);
  });

  it("rejects when the parent group is hidden", async () => {
    const admin = await createUser("admin");
    const { group, section } = await activeSectionWithSchema(admin, [cityField]);
    await updateCatalogGroup(group.id, { status: "hidden" }, admin);
    await expect(resolveActiveSectionChain(section.id)).rejects.toThrow(/not available for creating lots/);
  });

  it("succeeds on the full happy path (group, item, section active + published schema)", async () => {
    const admin = await createUser("admin");
    const { group, item, section } = await activeSectionWithSchema(admin, [cityField]);
    const chain = await resolveActiveSectionChain(section.id);
    expect(chain).toMatchObject({ sectionId: section.id, gameId: item.id, groupId: group.id });
  });
});

describe("schema status is validated explicitly, not inferred from current_schema_version alone", () => {
  it("does not treat a non-active schema row as usable even if current_schema_version points at it", async () => {
    const admin = await createUser("admin");
    const { section } = await createGroupItemSection(admin);
    const version = await createSchemaVersion(section.id, { fields: [cityField] }, admin);

    // Simulate an inconsistent row bypassing publishSchemaVersion (the only path that
    // normally keeps these two in sync) to prove the checks don't just trust
    // current_schema_version - they also require catalog_section_schemas.status = 'active'.
    await pool.query(`update game_sections set current_schema_version = $2 where id = $1`, [section.id, version.version]);
    await updateCatalogSection(section.id, { status: "active" }, admin);

    expect(await getActiveSchemaForSection(section.id)).toBeNull();
    await expect(resolveActiveSectionChain(section.id)).rejects.toThrow(/does not have a published schema/);
  });

  it("does not validate lot metadata against archived schema rows", async () => {
    const admin = await createUser("admin");
    const { section } = await createGroupItemSection(admin);
    const version = await createSchemaVersion(section.id, { fields: [{ ...cityField, required: true }] }, admin);

    await pool.query(`update game_sections set current_schema_version = $2 where id = $1`, [section.id, version.version]);
    await pool.query(`update catalog_section_schemas set status = 'archived' where id = $1`, [version.id]);

    const result = await validateLotMetadata(section.id, { unexpected: "kept because no active schema exists" });
    expect(result).toEqual({ metadata: { unexpected: "kept because no active schema exists" }, schemaVersion: null });
  });
});

// ---------------------------------------------------------------------------
// allowedDeliveryTypes enforcement on lot create/update
// ---------------------------------------------------------------------------

describe("allowedDeliveryTypes enforcement", () => {
  it("rejects creating a lot with a delivery type the section does not allow", async () => {
    const admin = await createUser("admin");
    const seller = await agentForUser(await verifiedSeller(), "user");
    const { section } = await activeSectionWithSchema(admin, [cityField], { allowedDeliveryTypes: ["manual"] });

    const response = await seller.post("/marketplace/products").send({
      sectionId: section.id,
      title: "Test lot title",
      description: "A description that is definitely long enough for validation",
      price: "100",
      deliveryType: "instant",
      metadata: { city: "Kyiv" }
    });
    expect(response.status).toBe(400);
    expect(response.body.error.message).toMatch(/does not allow delivery type/);
  });

  it("allows creating a lot with a delivery type the section does allow", async () => {
    const admin = await createUser("admin");
    const seller = await agentForUser(await verifiedSeller(), "user");
    const { section } = await activeSectionWithSchema(admin, [cityField], { allowedDeliveryTypes: ["manual"] });

    const response = await seller.post("/marketplace/products").send({
      sectionId: section.id,
      title: "Test lot title",
      description: "A description that is definitely long enough for validation",
      price: "100",
      deliveryType: "manual",
      metadata: { city: "Kyiv" }
    });
    expect(response.status).toBe(201);
  });

  it("allows every delivery type explicitly listed by the section", async () => {
    const admin = await createUser("admin");
    const seller = await agentForUser(await verifiedSeller(), "user");
    const { section } = await activeSectionWithSchema(admin, [cityField], { allowedDeliveryTypes: ["manual", "instant"] });

    const manual = await seller.post("/marketplace/products").send({
      sectionId: section.id,
      title: "Manual lot title",
      description: "A description that is definitely long enough for validation",
      price: "100",
      deliveryType: "manual",
      metadata: { city: "Kyiv" }
    });
    expect(manual.status).toBe(201);

    const instant = await seller.post("/marketplace/products").send({
      sectionId: section.id,
      title: "Instant lot title",
      description: "A description that is definitely long enough for validation",
      price: "100",
      deliveryType: "instant",
      metadata: { city: "Kyiv" }
    });
    expect(instant.status).toBe(201);
  });

  it("rejects PATCHing a lot to a delivery type the section does not allow", async () => {
    const admin = await createUser("admin");
    const seller = await agentForUser(await verifiedSeller(), "user");
    const { section } = await activeSectionWithSchema(admin, [cityField], { allowedDeliveryTypes: ["manual"] });

    const created = await seller.post("/marketplace/products").send({
      sectionId: section.id,
      title: "Test lot title",
      description: "A description that is definitely long enough for validation",
      price: "100",
      deliveryType: "manual",
      metadata: { city: "Kyiv" }
    });
    expect(created.status).toBe(201);

    const patched = await seller.patch(`/marketplace/products/${created.body.id}`).send({ deliveryType: "instant" });
    expect(patched.status).toBe(400);
    expect(patched.body.error.message).toMatch(/does not allow delivery type/);
  });
});

describe("product section/schema consistency", () => {
  const rankField = {
    key: "rank",
    label: "Rank",
    type: "select",
    required: true,
    options: ["Herald", "Divine"],
    filterable: true,
    showInCard: true,
    sortOrder: 1
  };
  const regionField = {
    key: "region",
    label: "Region",
    type: "select",
    required: true,
    options: ["EU", "NA"],
    filterable: true,
    showInCard: true,
    sortOrder: 1
  };

  async function createProductInSectionA() {
    const admin = await createUser("admin");
    const seller = await agentForUser(await verifiedSeller(), "user");
    const sectionA = await activeSectionWithSchema(admin, [rankField]);
    const sectionB = await activeSectionWithSchema(admin, [regionField]);
    const created = await seller.post("/marketplace/products").send({
      sectionId: sectionA.section.id,
      title: "Section consistency lot",
      description: "A description that is definitely long enough for validation",
      price: "100",
      deliveryType: "manual",
      metadata: { rank: "Divine" }
    });
    expect(created.status).toBe(201);
    return { admin, seller, productId: created.body.id as string, sectionA, sectionB };
  }

  async function loadContract(productId: string) {
    const result = await pool.query<{
      sectionId: string | null;
      schemaVersion: number | null;
      metadata: Record<string, unknown>;
      title: string;
      status: string;
    }>(
      `select section_id as "sectionId", schema_version as "schemaVersion", metadata, title, status
       from products where id = $1`,
      [productId]
    );
    return result.rows[0];
  }

  it("rejects changing section without metadata and leaves the old contract untouched", async () => {
    const { seller, productId, sectionB } = await createProductInSectionA();
    const before = await loadContract(productId);

    const response = await seller.patch(`/marketplace/products/${productId}`).send({
      sectionId: sectionB.section.id,
      title: "Must not be persisted"
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("validation_error");
    expect(await loadContract(productId)).toEqual(before);
  });

  it("updates section, schema version, and validated metadata together", async () => {
    const { seller, productId, sectionB } = await createProductInSectionA();

    const response = await seller.patch(`/marketplace/products/${productId}`).send({
      sectionId: sectionB.section.id,
      metadata: { region: "EU", staleKey: "dropped" }
    });

    expect(response.status).toBe(200);
    const row = await loadContract(productId);
    expect(row).toMatchObject({
      sectionId: sectionB.section.id,
      schemaVersion: 1,
      metadata: { region: "EU" }
    });
    const matchingSchema = await pool.query(
      `select 1 from catalog_section_schemas where section_id = $1 and version = $2`,
      [row.sectionId, row.schemaVersion]
    );
    expect(matchingSchema.rows).toHaveLength(1);
  });

  it("does not partially update any product fields when new-section metadata is invalid", async () => {
    const { seller, productId, sectionB } = await createProductInSectionA();
    const before = await loadContract(productId);

    const response = await seller.patch(`/marketplace/products/${productId}`).send({
      sectionId: sectionB.section.id,
      title: "Must roll back",
      metadata: { region: "APAC" },
      media: ["https://cdn.test/should-not-persist.webp"]
    });

    expect(response.status).toBe(400);
    expect(await loadContract(productId)).toEqual(before);
    const media = await pool.query(`select 1 from product_media where product_id = $1`, [productId]);
    expect(media.rows).toHaveLength(0);
  });

  it("cannot reactivate an outdated schema pair until current metadata is submitted", async () => {
    const admin = await createUser("admin");
    const seller = await agentForUser(await verifiedSeller(), "user");
    const { section } = await activeSectionWithSchema(admin, [rankField]);
    const created = await seller.post("/marketplace/products").send({
      sectionId: section.id,
      title: "Paused schema lot",
      description: "A description that is definitely long enough for validation",
      price: "100",
      deliveryType: "manual",
      metadata: { rank: "Divine" }
    });
    expect(created.status).toBe(201);
    expect((await seller.patch(`/marketplace/products/${created.body.id}`).send({ status: "paused" })).status).toBe(200);

    const v2 = await createSchemaVersion(section.id, { fields: [regionField] }, admin);
    await publishSchemaVersion(section.id, v2.id, admin);

    const rejected = await seller.patch(`/marketplace/products/${created.body.id}`).send({ status: "active" });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error.code).toBe("validation_error");
    expect(await loadContract(created.body.id)).toMatchObject({ status: "paused", schemaVersion: 1, metadata: { rank: "Divine" } });

    const activated = await seller.patch(`/marketplace/products/${created.body.id}`).send({
      status: "active",
      metadata: { region: "EU" }
    });
    expect(activated.status).toBe(200);
    expect(await loadContract(created.body.id)).toMatchObject({ status: "active", schemaVersion: 2, metadata: { region: "EU" } });
  });
});

// ---------------------------------------------------------------------------
// Metadata filters on GET /marketplace/products
// ---------------------------------------------------------------------------

describe("metadata filters on /marketplace/products", () => {
  it("filters by exact-match select and numeric range, rejects unknown/non-filterable keys", async () => {
    const admin = await createUser("admin");
    const sellerId = await verifiedSeller();
    const { item, section } = await activeSectionWithSchema(admin, [
      { key: "rank", label: "Rank", type: "select", required: true, options: ["Herald", "Divine"], filterable: true, showInCard: true, sortOrder: 1 },
      { key: "mmr", label: "MMR", type: "number", required: false, filterable: true, showInCard: true, sortOrder: 2 },
      { key: "verified", label: "Verified", type: "boolean", required: false, filterable: true, showInCard: true, sortOrder: 3 },
      { key: "hidden_note", label: "Hidden note", type: "text", required: false, filterable: false, showInCard: false, sortOrder: 4 }
    ]);
    await createProductForSection(sellerId, section.id, item.id, { rank: "Herald", mmr: 3000, verified: false });
    await createProductForSection(sellerId, section.id, item.id, { rank: "Divine", mmr: 9000, verified: true });

    const byRank = await request(app).get(`/marketplace/products?sectionId=${section.id}&meta[rank]=Divine`);
    expect(byRank.status).toBe(200);
    expect(byRank.body.products).toHaveLength(1);
    expect(byRank.body.products[0].metadata.rank).toBe("Divine");

    const byMmrRange = await request(app).get(`/marketplace/products?sectionId=${section.id}&meta[mmr][min]=5000&meta[mmr][max]=9500`);
    expect(byMmrRange.status).toBe(200);
    expect(byMmrRange.body.products).toHaveLength(1);
    expect(byMmrRange.body.products[0].metadata.mmr).toBe(9000);

    const byBoolean = await request(app).get(`/marketplace/products?sectionId=${section.id}&meta[verified]=true`);
    expect(byBoolean.status).toBe(200);
    expect(byBoolean.body.products).toHaveLength(1);
    expect(byBoolean.body.products[0].metadata.verified).toBe(true);

    const unknownKey = await request(app).get(`/marketplace/products?sectionId=${section.id}&meta[hidden_note]=x`);
    expect(unknownKey.status).toBe(400);
    expect(unknownKey.body.error.message).toMatch(/non-filterable/);

    const withoutSectionId = await request(app).get(`/marketplace/products?meta[rank]=Divine`);
    expect(withoutSectionId.status).toBe(400);
    expect(withoutSectionId.body.error.message).toMatch(/sectionId is required/);
  });
});

describe("schema version pinning on product output", () => {
  it("keeps an existing product on schema v1 after schema v2 is published", async () => {
    const admin = await createUser("admin");
    const seller = await agentForUser(await verifiedSeller(), "user");
    const { section } = await activeSectionWithSchema(admin, [
      { key: "rank", label: "Rank v1", type: "select", required: true, options: ["Herald", "Divine"], filterable: true, showInCard: true, sortOrder: 1 }
    ]);

    const created = await seller.post("/marketplace/products").send({
      sectionId: section.id,
      title: "Pinned schema lot",
      description: "A description that is definitely long enough for validation",
      price: "100",
      deliveryType: "manual",
      metadata: { rank: "Divine" }
    });
    expect(created.status).toBe(201);

    const v2 = await createSchemaVersion(
      section.id,
      { fields: [{ key: "rank", label: "Rank v2", type: "select", required: true, options: ["Herald", "Divine"], filterable: true, showInCard: true, sortOrder: 1 }] },
      admin
    );
    await publishSchemaVersion(section.id, v2.id, admin);

    const product = await request(app).get(`/marketplace/products/${created.body.id}`);
    expect(product.status).toBe(200);
    expect(product.body.product.schemaVersion).toBe(1);
    expect(product.body.product.metadataFields[0]).toMatchObject({ key: "rank", label: "Rank v1" });
  });
});

// ---------------------------------------------------------------------------
// Delete guard: an item with zero game_sections can still have products attached
// directly via game_id (section_id = null) - the legacy sectionless listing path.
// ---------------------------------------------------------------------------

describe("deleteCatalogItem guard for direct (sectionless) products", () => {
  it("blocks deleting an item that has products attached directly, with no game_sections at all", async () => {
    const admin = await createUser("admin");
    const seller = await createUser("user");
    const group = await createCatalogGroup({ slug: uniqueSlug("group"), name: "Group", status: "active" }, admin);
    const item = await createCatalogItem({ groupId: group.id, slug: uniqueSlug("item"), name: "Item", status: "active" }, admin);
    const category = await pool.query<{ id: string }>(`select id from categories limit 1`);
    await pool.query(
      `insert into products(seller_id, category_id, game_id, section_id, title, description, price_cents, currency, stock, delivery_type)
       values ($1, $2, $3, null, 'Direct product', 'A description long enough to pass validation', 1000, 'UAH', 5, 'manual')`,
      [seller, category.rows[0].id, item.id]
    );

    await expect(deleteCatalogItem(item.id, admin)).rejects.toThrow(/Cannot delete item with existing products/);
  });

  it("hard-deletes a pristine draft item with zero sections and zero direct products", async () => {
    const admin = await createUser("admin");
    const group = await createCatalogGroup({ slug: uniqueSlug("group"), name: "Group", status: "active" }, admin);
    const item = await createCatalogItem({ groupId: group.id, slug: uniqueSlug("item"), name: "Item" }, admin);
    const result = await deleteCatalogItem(item.id, admin);
    expect(result.hardDeleted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Audit log action-type precision
// ---------------------------------------------------------------------------

describe("audit action type precision", () => {
  async function lastAuditActionFor(targetId: string) {
    const result = await pool.query<{ action: string }>(
      `select action from audit_logs where metadata->>'targetId' = $1 order by created_at desc limit 1`,
      [targetId]
    );
    return result.rows[0]?.action;
  }

  it("logs distinct action types for hide/archive/delete transitions on a section", async () => {
    const admin = await createUser("admin");
    const { section } = await createGroupItemSection(admin);

    await updateCatalogSection(section.id, { status: "hidden" }, admin);
    expect(await lastAuditActionFor(section.id)).toBe("catalog_section_hidden");

    await updateCatalogSection(section.id, { status: "archived" }, admin);
    expect(await lastAuditActionFor(section.id)).toBe("catalog_section_archived");

    // Soft-delete path (status isn't 'draft' anymore) - previously mislabeled "_hidden"
    // even though the row's status is really set to 'deleted'.
    await deleteCatalogSection(section.id, admin);
    expect(await lastAuditActionFor(section.id)).toBe("catalog_section_deleted");
  });

  it("archives the previous active schema version and logs both action types when publishing a new one", async () => {
    const admin = await createUser("admin");
    const { section } = await createGroupItemSection(admin);

    const v1 = await createSchemaVersion(section.id, { fields: [cityField] }, admin);
    await publishSchemaVersion(section.id, v1.id, admin);
    expect(await lastAuditActionFor(v1.id)).toBe("catalog_schema_published");

    const v2 = await createSchemaVersion(section.id, { fields: [cityField] }, admin);
    await publishSchemaVersion(section.id, v2.id, admin);

    expect(await lastAuditActionFor(v2.id)).toBe("catalog_schema_published");
    expect(await lastAuditActionFor(v1.id)).toBe("catalog_schema_archived");

    const v1Row = await pool.query<{ status: string }>(`select status from catalog_section_schemas where id = $1`, [v1.id]);
    expect(v1Row.rows[0].status).toBe("archived");
  });
});

describe("catalog display & discovery fields", () => {
  it("persists display flags, aliases, and images on create and returns them from the admin tree", async () => {
    const admin = await createUser("admin");
    const group = await createCatalogGroup({ slug: uniqueSlug("group"), name: "Test Group", status: "active" }, admin);
    const item = await createCatalogItem(
      {
        groupId: group.id,
        slug: uniqueSlug("item"),
        name: "Roblox",
        status: "active",
        shortDescription: "Short blurb",
        description: "Long description",
        banner: "https://cdn.test/banner.webp",
        logoImage: "https://cdn.test/logo.webp",
        aliases: ["роблокс", "rblx"],
        showOnHomepage: false,
        isPopular: true,
        isRecommended: true,
        homepageOrder: 7
      },
      admin
    );

    expect(item.aliases).toEqual(["роблокс", "rblx"]);
    expect(item.showOnHomepage).toBe(false);
    expect(item.isPopular).toBe(true);
    expect(item.homepageOrder).toBe(7);

    const tree = await getAdminCatalogTree();
    const treeItem = tree.flatMap((g: { items: { id: string; aliases?: string[]; isRecommended?: boolean }[] }) => g.items).find((i) => i.id === item.id);
    expect(treeItem?.aliases).toEqual(["роблокс", "rblx"]);
    expect(treeItem?.isRecommended).toBe(true);
  });

  it("updates flags and aliases through the admin API and strips unknown/system fields", async () => {
    const agent = await authedAgent("admin");
    const group = await createCatalogGroup({ slug: uniqueSlug("group"), name: "G", status: "active" }, agent.userId);
    const item = await createCatalogItem({ groupId: group.id, slug: uniqueSlug("item"), name: "Item", status: "active" }, agent.userId);

    const response = await agent
      .patch(`/admin/catalog/items/${item.id}`)
      .send({ isPopular: true, aliases: ["алиас"], popularity: 99999, is_active: false });
    expect(response.status).toBe(200);
    expect(response.body.item.isPopular).toBe(true);
    expect(response.body.item.aliases).toEqual(["алиас"]);

    // zod strips unknown keys: legacy popularity / is_active must be untouched by the payload
    const row = await pool.query<{ popularity: number; is_active: boolean }>(`select popularity, is_active from games where id = $1`, [item.id]);
    expect(row.rows[0].popularity).toBe(0);
    expect(row.rows[0].is_active).toBe(true);
  });

  it("public games list exposes flags for active games and hides hidden games", async () => {
    const admin = await createUser("admin");
    const group = await createCatalogGroup({ slug: uniqueSlug("group"), name: "G", status: "active" }, admin);
    const visible = await createCatalogItem(
      { groupId: group.id, slug: uniqueSlug("vis"), name: "Visible Game", status: "active", isPopular: true },
      admin
    );
    const hidden = await createCatalogItem({ groupId: group.id, slug: uniqueSlug("hid"), name: "Hidden Game", status: "hidden" }, admin);

    await cacheDel("marketplace:games");
    const response = await request(app).get("/marketplace/games");
    expect(response.status).toBe(200);
    const slugs = response.body.games.map((game: { slug: string }) => game.slug);
    expect(slugs).toContain(visible.slug);
    expect(slugs).not.toContain(hidden.slug);
    const visibleRow = response.body.games.find((game: { slug: string }) => game.slug === visible.slug);
    expect(visibleRow.isPopular).toBe(true);
    expect(visibleRow.lotCount).toBe(0);
  });

  it("persists the admin-picked catalog type and exposes it publicly", async () => {
    const admin = await createUser("admin");
    const group = await createCatalogGroup({ slug: uniqueSlug("group"), name: "G", status: "active" }, admin);
    const item = await createCatalogItem(
      { groupId: group.id, slug: uniqueSlug("mob"), name: "Mobile Thing", status: "active", catalogType: "mobile" },
      admin
    );
    expect(item.catalogType).toBe("mobile");

    const updated = await updateCatalogItem(item.id, { catalogType: "service" }, admin);
    expect(updated.catalogType).toBe("service");

    await cacheDel("marketplace:games");
    const response = await request(app).get("/marketplace/games");
    const row = response.body.games.find((game: { slug: string }) => game.slug === item.slug);
    expect(row.catalogType).toBe("service");
  });

  it("suggest finds a game by Cyrillic alias", async () => {
    const admin = await createUser("admin");
    const group = await createCatalogGroup({ slug: uniqueSlug("group"), name: "G", status: "active" }, admin);
    // The test DB accumulates games across runs (resetDb only truncates users), so the
    // alias must be unique per run - otherwise older copies win the suggest LIMIT.
    const alias = uniqueSlug("роблокс");
    const item = await createCatalogItem(
      { groupId: group.id, slug: uniqueSlug("roblox"), name: "Roblox", status: "active", aliases: [alias] },
      admin
    );

    const response = await request(app).get("/marketplace/suggest").query({ q: alias.slice(0, alias.length - 2) });
    expect(response.status).toBe(200);
    const slugs = response.body.games.map((game: { slug: string }) => game.slug);
    expect(slugs).toContain(item.slug);
  });
});
