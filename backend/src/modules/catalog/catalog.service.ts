import crypto from "node:crypto";
import { inTx, pool, type DbClient } from "../../db/pool.js";
import { badRequest, notFound } from "../../common/errors.js";
import { parseCatalogSchema, validateMetadataAgainstSchema, type CatalogSchema } from "./catalog.validation.js";

export type CatalogStatus = "draft" | "active" | "hidden" | "archived" | "deleted";
const STATUSES: CatalogStatus[] = ["draft", "active", "hidden", "archived", "deleted"];
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function assertValidSlug(slug: string) {
  if (!SLUG_PATTERN.test(slug)) {
    throw badRequest("Slug must be lowercase letters, digits, and single hyphens between words");
  }
}

export function assertValidStatus(status: string): asserts status is CatalogStatus {
  if (!STATUSES.includes(status as CatalogStatus)) throw badRequest("Invalid status");
}

/** Slug is only editable while the entity is still a draft - published URLs must not move. */
function assertSlugEditable(currentStatus: CatalogStatus, currentSlug: string, nextSlug: string | undefined) {
  if (nextSlug !== undefined && nextSlug !== currentSlug && currentStatus !== "draft") {
    throw badRequest("Slug can only be changed while status is draft");
  }
}

function buildDynamicUpdate(id: string, fields: Record<string, unknown>) {
  const values: unknown[] = [id];
  const sets: string[] = [];
  for (const [column, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  }
  return { sets, values };
}

/**
 * Every mutating catalog action writes a structured row into the existing `audit_logs`
 * table (not a new table - it already exists and is jsonb-flexible). This is in addition
 * to, not instead of, the automatic generic request logger in request-context.ts, which
 * only ever captures `{method, path, request_body, params, query}` and has no concept of
 * targetType/before/after.
 */
export async function recordCatalogAudit(
  input: {
    adminId: string;
    actionType: string;
    targetType: "catalog_group" | "catalog_item" | "catalog_section" | "catalog_schema";
    targetId: string;
    before?: unknown;
    after?: unknown;
    metadata?: Record<string, unknown>;
  },
  client: DbClient = pool
): Promise<void> {
  await client.query(
    `insert into audit_logs(trace_id, user_id, method, path, endpoint, status_code, action, request_body, metadata)
     values ($1, $2, 'CATALOG', '/admin/catalog', 'catalog_builder', 200, $3, null, $4)`,
    [
      crypto.randomUUID(),
      input.adminId,
      input.actionType,
      JSON.stringify({
        targetType: input.targetType,
        targetId: input.targetId,
        before: input.before ?? null,
        after: input.after ?? null,
        ...input.metadata
      })
    ]
  );
}

/**
 * Picks the precise audit action type for a group/item/section update: if `status` is the
 * field that changed, log the specific transition (published/hidden/archived/deleted)
 * instead of a generic "updated" - matters for reading the audit trail later.
 */
function statusChangeActionType(targetKind: "group" | "item" | "section", previousStatus: string, input: { status?: string }): string {
  if (input.status === undefined || input.status === previousStatus) return `catalog_${targetKind}_updated`;
  switch (input.status) {
    case "active":
      return `catalog_${targetKind}_published`;
    case "hidden":
      return `catalog_${targetKind}_hidden`;
    case "archived":
      return `catalog_${targetKind}_archived`;
    case "deleted":
      return `catalog_${targetKind}_deleted`;
    default:
      return `catalog_${targetKind}_updated`;
  }
}

// ---------------------------------------------------------------------------
// Catalog Groups
// ---------------------------------------------------------------------------

export type CatalogGroupInput = {
  slug: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  sortOrder?: number;
  seoTitle?: string | null;
  seoDescription?: string | null;
  status?: CatalogStatus;
};

export async function createCatalogGroup(input: CatalogGroupInput, adminId: string) {
  assertValidSlug(input.slug);
  const result = await pool.query(
    `insert into catalog_groups(slug, name, description, icon, sort_order, seo_title, seo_description, status)
     values ($1, $2, $3, $4, coalesce($5, 0), $6, $7, coalesce($8, 'draft'))
     returning id, slug, name, description, icon, sort_order as "sortOrder", seo_title as "seoTitle",
               seo_description as "seoDescription", status, created_at as "createdAt", updated_at as "updatedAt"`,
    [input.slug, input.name, input.description ?? null, input.icon ?? null, input.sortOrder, input.seoTitle ?? null, input.seoDescription ?? null, input.status]
  );
  const group = result.rows[0];
  await recordCatalogAudit({ adminId, actionType: "catalog_group_created", targetType: "catalog_group", targetId: group.id, after: group });
  return group;
}

export async function updateCatalogGroup(id: string, input: Partial<CatalogGroupInput>, adminId: string) {
  const existing = await getCatalogGroupRow(id);
  if (input.slug !== undefined) assertValidSlug(input.slug);
  assertSlugEditable(existing.status, existing.slug, input.slug);
  if (input.status !== undefined) assertValidStatus(input.status);

  const { sets, values } = buildDynamicUpdate(id, {
    slug: input.slug,
    name: input.name,
    description: input.description,
    icon: input.icon,
    sort_order: input.sortOrder,
    seo_title: input.seoTitle,
    seo_description: input.seoDescription,
    status: input.status
  });
  if (!sets.length) return existing;

  const result = await pool.query(
    `update catalog_groups set ${sets.join(", ")}, updated_at = now() where id = $1
     returning id, slug, name, description, icon, sort_order as "sortOrder", seo_title as "seoTitle",
               seo_description as "seoDescription", status, created_at as "createdAt", updated_at as "updatedAt"`,
    values
  );
  const updated = result.rows[0];
  await recordCatalogAudit({
    adminId,
    actionType: statusChangeActionType("group", existing.status, input),
    targetType: "catalog_group",
    targetId: id,
    before: existing,
    after: updated
  });
  return updated;
}

export async function deleteCatalogGroup(id: string, adminId: string) {
  const existing = await getCatalogGroupRow(id);
  const children = await pool.query(`select count(*)::int as count from games where group_id = $1`, [id]);

  if (existing.status === "draft" && children.rows[0].count === 0) {
    await pool.query(`delete from catalog_groups where id = $1`, [id]);
    await recordCatalogAudit({ adminId, actionType: "catalog_group_deleted", targetType: "catalog_group", targetId: id, before: existing });
    return { hardDeleted: true };
  }

  const result = await pool.query(
    `update catalog_groups set status = 'deleted', deleted_at = now(), updated_at = now() where id = $1
     returning id, slug, name, status`,
    [id]
  );
  await recordCatalogAudit({ adminId, actionType: "catalog_group_deleted", targetType: "catalog_group", targetId: id, before: existing, after: result.rows[0] });
  return { hardDeleted: false, group: result.rows[0] };
}

async function getCatalogGroupRow(id: string) {
  const result = await pool.query(`select id, slug, name, status, description, icon, sort_order as "sortOrder" from catalog_groups where id = $1`, [id]);
  if (!result.rows[0]) throw notFound("Group not found");
  return result.rows[0] as { id: string; slug: string; name: string; status: CatalogStatus; description: string | null; icon: string | null; sortOrder: number };
}

// ---------------------------------------------------------------------------
// Catalog Items (games)
// ---------------------------------------------------------------------------

export type CatalogItemInput = {
  groupId: string;
  slug: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  banner?: string | null;
  sortOrder?: number;
  seoTitle?: string | null;
  seoDescription?: string | null;
  status?: CatalogStatus;
};

export async function createCatalogItem(input: CatalogItemInput, adminId: string) {
  assertValidSlug(input.slug);
  const group = await pool.query(`select id from catalog_groups where id = $1`, [input.groupId]);
  if (!group.rows[0]) throw notFound("Group not found");

  const result = await pool.query(
    `insert into games(group_id, slug, name, publisher, icon_url, banner, sort_order, seo_title, seo_description, status, is_active)
     values ($1, $2, $3, null, $4, $5, coalesce($6, 0), $7, $8, coalesce($9, 'draft'), false)
     returning id, group_id as "groupId", slug, name, icon_url as "icon", banner, sort_order as "sortOrder",
               seo_title as "seoTitle", seo_description as "seoDescription", status, created_at as "createdAt"`,
    [input.groupId, input.slug, input.name, input.icon ?? null, input.banner ?? null, input.sortOrder, input.seoTitle ?? null, input.seoDescription ?? null, input.status]
  );
  const item = result.rows[0];
  await recordCatalogAudit({ adminId, actionType: "catalog_item_created", targetType: "catalog_item", targetId: item.id, after: item });
  return item;
}

export async function updateCatalogItem(id: string, input: Partial<CatalogItemInput>, adminId: string) {
  const existing = await getCatalogItemRow(id);
  if (input.slug !== undefined) assertValidSlug(input.slug);
  assertSlugEditable(existing.status, existing.slug, input.slug);
  if (input.status !== undefined) assertValidStatus(input.status);
  if (input.groupId !== undefined) {
    const group = await pool.query(`select id from catalog_groups where id = $1`, [input.groupId]);
    if (!group.rows[0]) throw notFound("Group not found");
  }

  const { sets, values } = buildDynamicUpdate(id, {
    group_id: input.groupId,
    slug: input.slug,
    name: input.name,
    icon_url: input.icon,
    banner: input.banner,
    sort_order: input.sortOrder,
    seo_title: input.seoTitle,
    seo_description: input.seoDescription,
    status: input.status
  });
  if (!sets.length) return existing;

  const result = await pool.query(
    `update games set ${sets.join(", ")} where id = $1
     returning id, group_id as "groupId", slug, name, icon_url as "icon", banner, sort_order as "sortOrder",
               seo_title as "seoTitle", seo_description as "seoDescription", status`,
    values
  );
  const updated = result.rows[0];
  await recordCatalogAudit({
    adminId,
    actionType: statusChangeActionType("item", existing.status, input),
    targetType: "catalog_item",
    targetId: id,
    before: existing,
    after: updated
  });
  return updated;
}

export async function deleteCatalogItem(id: string, adminId: string) {
  const existing = await getCatalogItemRow(id);
  const sections = await pool.query(`select count(*)::int as count from game_sections where game_id = $1`, [id]);
  // Products can reference an item directly via game_id with section_id = null (the legacy
  // sectionless listing path) - a zero-sections item can still have products attached this
  // way, so the hard-delete guard must check both, not just game_sections.
  const directProducts = await pool.query(`select count(*)::int as count from products where game_id = $1`, [id]);

  if (existing.status === "draft" && sections.rows[0].count === 0 && directProducts.rows[0].count === 0) {
    await pool.query(`delete from games where id = $1`, [id]);
    await recordCatalogAudit({ adminId, actionType: "catalog_item_deleted", targetType: "catalog_item", targetId: id, before: existing });
    return { hardDeleted: true };
  }
  if (directProducts.rows[0].count > 0) {
    throw badRequest("Cannot delete item with existing products");
  }

  const result = await pool.query(`update games set status = 'deleted' where id = $1 returning id, slug, name, status`, [id]);
  await recordCatalogAudit({ adminId, actionType: "catalog_item_deleted", targetType: "catalog_item", targetId: id, before: existing, after: result.rows[0] });
  return { hardDeleted: false, item: result.rows[0] };
}

async function getCatalogItemRow(id: string) {
  const result = await pool.query(`select id, group_id as "groupId", slug, name, status from games where id = $1`, [id]);
  if (!result.rows[0]) throw notFound("Item not found");
  return result.rows[0] as { id: string; groupId: string; slug: string; name: string; status: CatalogStatus };
}

// ---------------------------------------------------------------------------
// Catalog Sections (game_sections)
// ---------------------------------------------------------------------------

export type CatalogSectionInput = {
  itemId: string;
  categoryId?: string;
  slug: string;
  name: string;
  description?: string | null;
  listingType?: string;
  allowedDeliveryTypes?: string[];
  requiresModeration?: boolean;
  sortOrder?: number;
  seoTitle?: string | null;
  seoDescription?: string | null;
  status?: CatalogStatus;
};

const LISTING_TYPES = ["account", "key", "topup", "boosting", "service", "item", "currency"] as const;
const DELIVERY_TYPES = ["instant", "manual", "service"] as const;

export async function createCatalogSection(input: CatalogSectionInput, adminId: string) {
  assertValidSlug(input.slug);
  const item = await pool.query(`select id from games where id = $1`, [input.itemId]);
  if (!item.rows[0]) throw notFound("Item not found");
  if (input.listingType && !LISTING_TYPES.includes(input.listingType as (typeof LISTING_TYPES)[number])) {
    throw badRequest(`Invalid listingType: must be one of ${LISTING_TYPES.join(", ")}`);
  }
  const deliveryTypes = input.allowedDeliveryTypes ?? ["manual", "instant"];
  for (const type of deliveryTypes) {
    if (!DELIVERY_TYPES.includes(type as (typeof DELIVERY_TYPES)[number])) {
      throw badRequest(`Invalid allowedDeliveryTypes value: must be one of ${DELIVERY_TYPES.join(", ")}`);
    }
  }
  // products.category_id is not-null (pre-existing constraint, unrelated to the catalog
  // builder) and categories.risk_level drives moderation strictness for the lots created
  // under this section - so the admin must pick one explicitly rather than us guessing a
  // risk level on their behalf.
  if (!input.categoryId) throw badRequest("categoryId is required");
  const category = await pool.query(`select id from categories where id = $1`, [input.categoryId]);
  if (!category.rows[0]) throw notFound("Category not found");

  const result = await pool.query(
    `insert into game_sections(game_id, category_id, slug, name, description, product_type, allowed_delivery_types,
                                requires_moderation, sort_order, seo_title, seo_description, status, is_active, schema)
     values ($1, $2, $3, $4, $5, coalesce($6, 'service'), $7, coalesce($8, false), coalesce($9, 0), $10, $11, coalesce($12, 'draft'), false, '{}'::jsonb)
     returning id, game_id as "itemId", category_id as "categoryId", slug, name, description, product_type as "listingType",
               allowed_delivery_types as "allowedDeliveryTypes", requires_moderation as "requiresModeration",
               sort_order as "sortOrder", seo_title as "seoTitle", seo_description as "seoDescription",
               status, current_schema_version as "currentSchemaVersion", created_at as "createdAt"`,
    [
      input.itemId,
      input.categoryId,
      input.slug,
      input.name,
      input.description ?? null,
      input.listingType,
      deliveryTypes,
      input.requiresModeration,
      input.sortOrder,
      input.seoTitle ?? null,
      input.seoDescription ?? null,
      input.status
    ]
  );
  const section = result.rows[0];
  await recordCatalogAudit({ adminId, actionType: "catalog_section_created", targetType: "catalog_section", targetId: section.id, after: section });
  return section;
}

export async function updateCatalogSection(id: string, input: Partial<CatalogSectionInput>, adminId: string) {
  const existing = await getCatalogSectionRow(id);
  if (input.slug !== undefined) assertValidSlug(input.slug);
  assertSlugEditable(existing.status, existing.slug, input.slug);
  if (input.status !== undefined) assertValidStatus(input.status);
  if (input.listingType && !LISTING_TYPES.includes(input.listingType as (typeof LISTING_TYPES)[number])) {
    throw badRequest(`Invalid listingType: must be one of ${LISTING_TYPES.join(", ")}`);
  }
  if (input.allowedDeliveryTypes) {
    for (const type of input.allowedDeliveryTypes) {
      if (!DELIVERY_TYPES.includes(type as (typeof DELIVERY_TYPES)[number])) {
        throw badRequest(`Invalid allowedDeliveryTypes value: must be one of ${DELIVERY_TYPES.join(", ")}`);
      }
    }
  }
  if (input.categoryId !== undefined) {
    const category = await pool.query(`select id from categories where id = $1`, [input.categoryId]);
    if (!category.rows[0]) throw notFound("Category not found");
  }

  const { sets, values } = buildDynamicUpdate(id, {
    slug: input.slug,
    name: input.name,
    description: input.description,
    category_id: input.categoryId,
    product_type: input.listingType,
    allowed_delivery_types: input.allowedDeliveryTypes,
    requires_moderation: input.requiresModeration,
    sort_order: input.sortOrder,
    seo_title: input.seoTitle,
    seo_description: input.seoDescription,
    status: input.status
  });
  if (!sets.length) return existing;

  const result = await pool.query(
    `update game_sections set ${sets.join(", ")} where id = $1
     returning id, game_id as "itemId", category_id as "categoryId", slug, name, description, product_type as "listingType",
               allowed_delivery_types as "allowedDeliveryTypes", requires_moderation as "requiresModeration",
               sort_order as "sortOrder", seo_title as "seoTitle", seo_description as "seoDescription",
               status, current_schema_version as "currentSchemaVersion"`,
    values
  );
  const updated = result.rows[0];
  await recordCatalogAudit({
    adminId,
    actionType: statusChangeActionType("section", existing.status, input),
    targetType: "catalog_section",
    targetId: id,
    before: existing,
    after: updated
  });
  return updated;
}

export async function deleteCatalogSection(id: string, adminId: string) {
  const existing = await getCatalogSectionRow(id);
  const products = await pool.query(`select count(*)::int as count from products where section_id = $1`, [id]);
  const schemas = await pool.query(`select count(*)::int as count from catalog_section_schemas where section_id = $1`, [id]);

  if (existing.status === "draft" && products.rows[0].count === 0 && schemas.rows[0].count === 0) {
    await pool.query(`delete from game_sections where id = $1`, [id]);
    await recordCatalogAudit({ adminId, actionType: "catalog_section_deleted", targetType: "catalog_section", targetId: id, before: existing });
    return { hardDeleted: true };
  }
  if (products.rows[0].count > 0) {
    throw badRequest("Cannot delete section with existing products");
  }

  const result = await pool.query(`update game_sections set status = 'deleted' where id = $1 returning id, slug, name, status`, [id]);
  await recordCatalogAudit({ adminId, actionType: "catalog_section_deleted", targetType: "catalog_section", targetId: id, before: existing, after: result.rows[0] });
  return { hardDeleted: false, section: result.rows[0] };
}

/** Publish is section-specific (unlike groups/items) because it has an extra precondition. */
export async function publishCatalogSection(id: string, adminId: string) {
  const existing = await getCatalogSectionRow(id);
  if (!existing.currentSchemaVersion) {
    throw badRequest("Cannot publish section without schema");
  }
  const result = await pool.query(
    `update game_sections set status = 'active' where id = $1
     returning id, slug, name, status, current_schema_version as "currentSchemaVersion"`,
    [id]
  );
  await recordCatalogAudit({ adminId, actionType: "catalog_section_published", targetType: "catalog_section", targetId: id, before: existing, after: result.rows[0] });
  return result.rows[0];
}

export async function setCatalogSectionStatus(id: string, status: Exclude<CatalogStatus, "active">, adminId: string) {
  assertValidStatus(status);
  const existing = await getCatalogSectionRow(id);
  const result = await pool.query(
    `update game_sections set status = $2 where id = $1 returning id, slug, name, status`,
    [id, status]
  );
  const actionType = status === "hidden" ? "catalog_section_hidden" : status === "archived" ? "catalog_section_archived" : "catalog_section_updated";
  await recordCatalogAudit({ adminId, actionType, targetType: "catalog_section", targetId: id, before: existing, after: result.rows[0] });
  return result.rows[0];
}

async function getCatalogSectionRow(id: string) {
  const result = await pool.query(
    `select id, game_id as "itemId", slug, name, status, current_schema_version as "currentSchemaVersion"
     from game_sections where id = $1`,
    [id]
  );
  if (!result.rows[0]) throw notFound("Section not found");
  return result.rows[0] as { id: string; itemId: string; slug: string; name: string; status: CatalogStatus; currentSchemaVersion: number | null };
}

// ---------------------------------------------------------------------------
// Section Schemas (versioned)
// ---------------------------------------------------------------------------

export async function listSchemaVersions(sectionId: string) {
  const result = await pool.query(
    `select id, section_id as "sectionId", version, schema, status, created_by as "createdBy",
            created_at as "createdAt", published_at as "publishedAt"
     from catalog_section_schemas where section_id = $1 order by version desc`,
    [sectionId]
  );
  return result.rows;
}

export async function createSchemaVersion(sectionId: string, rawSchema: unknown, adminId: string) {
  const section = await getCatalogSectionRow(sectionId);
  const schema = parseCatalogSchema(rawSchema);

  const latest = await pool.query(`select coalesce(max(version), 0) as max from catalog_section_schemas where section_id = $1`, [sectionId]);
  const nextVersion = Number(latest.rows[0].max) + 1;

  const result = await pool.query(
    `insert into catalog_section_schemas(section_id, version, schema, status, created_by)
     values ($1, $2, $3, 'draft', $4)
     returning id, section_id as "sectionId", version, schema, status, created_by as "createdBy", created_at as "createdAt"`,
    [sectionId, nextVersion, JSON.stringify(schema), adminId]
  );
  const created = result.rows[0];
  await recordCatalogAudit({ adminId, actionType: "catalog_schema_created", targetType: "catalog_schema", targetId: created.id, after: created, metadata: { sectionId: section.id } });
  return created;
}

export async function updateSchemaVersion(sectionId: string, schemaId: string, rawSchema: unknown, adminId: string) {
  const existing = await getSchemaRow(sectionId, schemaId);
  if (existing.status !== "draft") {
    throw badRequest("Only a draft schema version can be edited");
  }
  const schema = parseCatalogSchema(rawSchema);

  const result = await pool.query(
    `update catalog_section_schemas set schema = $2 where id = $1
     returning id, section_id as "sectionId", version, schema, status, created_by as "createdBy", created_at as "createdAt"`,
    [schemaId, JSON.stringify(schema)]
  );
  const updated = result.rows[0];
  await recordCatalogAudit({ adminId, actionType: "catalog_schema_updated", targetType: "catalog_schema", targetId: schemaId, before: existing, after: updated });
  return updated;
}

/**
 * Archiving the old version, activating the new one, and repointing the section's
 * current_schema_version must succeed or fail together - a partial write here would leave
 * a section with either no active schema or two, so this runs in a single transaction.
 */
export async function publishSchemaVersion(sectionId: string, schemaId: string, adminId: string) {
  const schemaRow = await getSchemaRow(sectionId, schemaId);
  if (schemaRow.status === "active") return schemaRow;

  return inTx(async (client) => {
    const previousActive = await client.query(
      `select id, section_id as "sectionId", version, schema, status
       from catalog_section_schemas where section_id = $1 and status = 'active'`,
      [sectionId]
    );

    if (previousActive.rows[0]) {
      const archived = await client.query(
        `update catalog_section_schemas set status = 'archived' where id = $1
         returning id, section_id as "sectionId", version, schema, status`,
        [previousActive.rows[0].id]
      );
      await recordCatalogAudit(
        {
          adminId,
          actionType: "catalog_schema_archived",
          targetType: "catalog_schema",
          targetId: previousActive.rows[0].id,
          before: previousActive.rows[0],
          after: archived.rows[0],
          metadata: { sectionId }
        },
        client
      );
    }

    const result = await client.query(
      `update catalog_section_schemas set status = 'active', published_at = now() where id = $1
       returning id, section_id as "sectionId", version, schema, status, published_at as "publishedAt"`,
      [schemaId]
    );
    await client.query(`update game_sections set current_schema_version = $2 where id = $1`, [sectionId, result.rows[0].version]);

    const published = result.rows[0];
    await recordCatalogAudit(
      { adminId, actionType: "catalog_schema_published", targetType: "catalog_schema", targetId: schemaId, before: schemaRow, after: published, metadata: { sectionId } },
      client
    );
    return published;
  });
}

async function getSchemaRow(sectionId: string, schemaId: string) {
  const result = await pool.query(
    `select id, section_id as "sectionId", version, schema, status
     from catalog_section_schemas where id = $1 and section_id = $2`,
    [schemaId, sectionId]
  );
  if (!result.rows[0]) throw notFound("Schema version not found");
  return result.rows[0] as { id: string; sectionId: string; version: number; schema: CatalogSchema; status: "draft" | "active" | "archived" };
}

/**
 * Used by lot creation/update to fetch + validate metadata against the section's live schema.
 * `cs.status = 'active'` is checked explicitly rather than trusted implicitly from
 * `current_schema_version` alone - the two are kept in sync by publishSchemaVersion today,
 * but this is the defense-in-depth check, not a assumption about how that invariant holds.
 */
export async function getActiveSchemaForSection(sectionId: string): Promise<CatalogSchema | null> {
  const result = await pool.query(
    `select cs.schema
     from game_sections gs
     join catalog_section_schemas cs on cs.section_id = gs.id and cs.version = gs.current_schema_version
     where gs.id = $1 and cs.status = 'active'`,
    [sectionId]
  );
  return (result.rows[0]?.schema as CatalogSchema | undefined) ?? null;
}

/**
 * Validates + filters a lot's metadata against its section's active schema, and returns
 * the schema_version to stamp onto the product row so a later schema edit never changes
 * how an already-created lot displays or re-validates (see the products migration).
 */
export async function validateLotMetadata(
  sectionId: string | null,
  rawMetadata: Record<string, unknown>
): Promise<{ metadata: Record<string, unknown>; schemaVersion: number | null }> {
  if (!sectionId) return { metadata: rawMetadata, schemaVersion: null };

  const result = await pool.query(
    `select gs.current_schema_version as "schemaVersion", cs.schema
     from game_sections gs
     left join catalog_section_schemas cs on cs.section_id = gs.id and cs.version = gs.current_schema_version and cs.status = 'active'
     where gs.id = $1`,
    [sectionId]
  );
  const row = result.rows[0] as { schemaVersion: number | null; schema: CatalogSchema | null } | undefined;
  if (!row?.schema) return { metadata: rawMetadata, schemaVersion: null };

  return { metadata: validateMetadataAgainstSchema(row.schema, rawMetadata), schemaVersion: row.schemaVersion };
}

/** Schema for a specific historical version - used to label an existing lot's metadata by
 * the schema it was actually created under, not whatever is current for the section now. */
export async function getSchemaByVersion(sectionId: string, version: number): Promise<CatalogSchema | null> {
  const result = await pool.query(
    `select schema from catalog_section_schemas where section_id = $1 and version = $2`,
    [sectionId, version]
  );
  return (result.rows[0]?.schema as CatalogSchema | undefined) ?? null;
}

export type ActiveSectionChain = {
  sectionId: string;
  categoryId: string;
  gameId: string;
  groupId: string;
  productType: string;
  allowedDeliveryTypes: string[];
};

/**
 * The only place that decides whether a section is actually open for new/updated lots:
 * its own status, its parent item's status, its parent group's status, and whether it has
 * a published (active) schema must all check out. Used by both create and update so a lot
 * can never be attached to a section that isn't fully live, regardless of which route it
 * comes through.
 */
export async function resolveActiveSectionChain(sectionId: string): Promise<ActiveSectionChain> {
  const result = await pool.query(
    `select
       gs.id as "sectionId", gs.category_id as "categoryId", gs.game_id as "gameId",
       gs.product_type as "productType", gs.allowed_delivery_types as "allowedDeliveryTypes",
       gs.status as "sectionStatus", gs.current_schema_version as "currentSchemaVersion",
       g.group_id as "groupId", g.status as "itemStatus",
       cg.status as "groupStatus",
       cs.status as "schemaStatus"
     from game_sections gs
     join games g on g.id = gs.game_id
     join catalog_groups cg on cg.id = g.group_id
     left join catalog_section_schemas cs on cs.section_id = gs.id and cs.version = gs.current_schema_version
     where gs.id = $1`,
    [sectionId]
  );
  const row = result.rows[0];
  if (!row) throw notFound("Section not found");
  if (row.groupStatus !== "active" || row.itemStatus !== "active" || row.sectionStatus !== "active") {
    throw badRequest("This section is not available for creating lots");
  }
  if (!row.currentSchemaVersion || row.schemaStatus !== "active") {
    throw badRequest("This section does not have a published schema yet");
  }

  return {
    sectionId: row.sectionId,
    categoryId: row.categoryId,
    gameId: row.gameId,
    groupId: row.groupId,
    productType: row.productType,
    allowedDeliveryTypes: row.allowedDeliveryTypes
  };
}

// ---------------------------------------------------------------------------
// Catalog Tree (public + admin read)
// ---------------------------------------------------------------------------

export async function getPublicGroupBySlug(slug: string) {
  const group = await pool.query(
    `select id, slug, name, description, icon from catalog_groups where slug = $1 and status = 'active'`,
    [slug]
  );
  if (!group.rows[0]) throw notFound("Group not found");

  const items = await pool.query(
    `select id, slug, name, icon_url as "icon", banner
     from games where group_id = $1 and status = 'active' order by sort_order, name`,
    [group.rows[0].id]
  );
  return { ...group.rows[0], items: items.rows };
}

export async function getPublicItemBySlug(slug: string) {
  const item = await pool.query(
    `select id, group_id as "groupId", slug, name, icon_url as "icon", banner
     from games where slug = $1 and status = 'active'`,
    [slug]
  );
  if (!item.rows[0]) throw notFound("Item not found");

  const sections = await pool.query(
    `select gs.id, gs.slug, gs.name, gs.product_type as "listingType", gs.allowed_delivery_types as "allowedDeliveryTypes",
            c.risk_level as "categoryRiskLevel"
     from game_sections gs
     left join categories c on c.id = gs.category_id
     where gs.game_id = $1 and gs.status = 'active'
     order by gs.sort_order, gs.name`,
    [item.rows[0].id]
  );
  return { ...item.rows[0], sections: sections.rows };
}

export async function getPublicCatalogTree() {
  const result = await pool.query(`
    select
      g.id, g.slug, g.name, g.description, g.icon,
      i.id as "itemId", i.slug as "itemSlug", i.name as "itemName", i.icon_url as "itemIcon", i.banner as "itemBanner",
      s.id as "sectionId", s.slug as "sectionSlug", s.name as "sectionName", s.product_type as "listingType",
      s.allowed_delivery_types as "allowedDeliveryTypes", c.risk_level as "categoryRiskLevel"
    from catalog_groups g
    join games i on i.group_id = g.id and i.status = 'active'
    join game_sections s on s.game_id = i.id and s.status = 'active'
    left join categories c on c.id = s.category_id
    where g.status = 'active'
    order by g.sort_order, i.sort_order, s.sort_order
  `);
  return buildTree(result.rows);
}

export async function getAdminCatalogTree() {
  const result = await pool.query(`
    select
      g.id, g.slug, g.name, g.description, g.icon, g.status,
      g.sort_order as "sortOrder", g.seo_title as "seoTitle", g.seo_description as "seoDescription",
      i.id as "itemId", i.slug as "itemSlug", i.name as "itemName", i.icon_url as "itemIcon", i.banner as "itemBanner", i.status as "itemStatus",
      i.sort_order as "itemSortOrder", i.seo_title as "itemSeoTitle", i.seo_description as "itemSeoDescription",
      s.id as "sectionId", s.slug as "sectionSlug", s.name as "sectionName", s.product_type as "listingType",
      s.allowed_delivery_types as "allowedDeliveryTypes", s.status as "sectionStatus", s.category_id as "categoryId",
      s.requires_moderation as "requiresModeration", s.sort_order as "sectionSortOrder",
      s.seo_title as "sectionSeoTitle", s.seo_description as "sectionSeoDescription",
      s.current_schema_version as "currentSchemaVersion",
      (select count(*)::int from products p where p.section_id = s.id) as "productCount"
    from catalog_groups g
    left join games i on i.group_id = g.id
    left join game_sections s on s.game_id = i.id
    order by g.sort_order, i.sort_order nulls last, s.sort_order nulls last
  `);
  return buildTree(result.rows, { includeStatus: true });
}

type TreeRow = {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  status?: string;
  sortOrder?: number;
  seoTitle?: string | null;
  seoDescription?: string | null;
  itemId?: string | null;
  itemSlug?: string;
  itemName?: string;
  itemIcon?: string | null;
  itemBanner?: string | null;
  itemStatus?: string;
  itemSortOrder?: number;
  itemSeoTitle?: string | null;
  itemSeoDescription?: string | null;
  sectionId?: string | null;
  sectionSlug?: string;
  sectionName?: string;
  listingType?: string;
  allowedDeliveryTypes?: string[];
  categoryId?: string | null;
  categoryRiskLevel?: string | null;
  requiresModeration?: boolean;
  sectionSortOrder?: number;
  sectionSeoTitle?: string | null;
  sectionSeoDescription?: string | null;
  sectionStatus?: string;
  currentSchemaVersion?: number | null;
  productCount?: number;
};

function buildTree(rows: TreeRow[], opts: { includeStatus?: boolean } = {}) {
  const groups = new Map<string, any>();

  for (const row of rows) {
    let group = groups.get(row.id);
    if (!group) {
      group = {
        id: row.id,
        slug: row.slug,
        name: row.name,
        description: row.description ?? null,
        icon: row.icon ?? null,
        ...(opts.includeStatus
          ? { status: row.status, sortOrder: row.sortOrder, seoTitle: row.seoTitle ?? null, seoDescription: row.seoDescription ?? null }
          : {}),
        items: new Map<string, any>()
      };
      groups.set(row.id, group);
    }

    if (!row.itemId) continue;
    let item = group.items.get(row.itemId);
    if (!item) {
      item = {
        id: row.itemId,
        slug: row.itemSlug,
        name: row.itemName,
        icon: row.itemIcon ?? null,
        banner: row.itemBanner ?? null,
        ...(opts.includeStatus
          ? { status: row.itemStatus, sortOrder: row.itemSortOrder, seoTitle: row.itemSeoTitle ?? null, seoDescription: row.itemSeoDescription ?? null }
          : {}),
        sections: new Map<string, any>()
      };
      group.items.set(row.itemId, item);
    }

    if (!row.sectionId) continue;
    if (!item.sections.has(row.sectionId)) {
      item.sections.set(row.sectionId, {
        id: row.sectionId,
        slug: row.sectionSlug,
        name: row.sectionName,
        listingType: row.listingType,
        allowedDeliveryTypes: row.allowedDeliveryTypes,
        categoryRiskLevel: row.categoryRiskLevel ?? null,
        ...(opts.includeStatus
          ? {
              status: row.sectionStatus,
              currentSchemaVersion: row.currentSchemaVersion,
              productCount: row.productCount,
              categoryId: row.categoryId ?? null,
              requiresModeration: row.requiresModeration ?? false,
              sortOrder: row.sectionSortOrder,
              seoTitle: row.sectionSeoTitle ?? null,
              seoDescription: row.sectionSeoDescription ?? null
            }
          : {})
      });
    }
  }

  return Array.from(groups.values()).map((group) => ({
    ...group,
    items: Array.from(group.items.values()).map((item: any) => ({
      ...item,
      sections: Array.from(item.sections.values())
    }))
  }));
}
