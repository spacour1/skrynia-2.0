import { pool } from "../../db/pool.js";
import { badRequest, notFound } from "../../common/errors.js";
import { assertSlugEditable, assertValidSlug, assertValidStatus, buildDynamicUpdate, recordCatalogAudit, statusChangeActionType, type CatalogStatus } from "./catalog.helpers.js";

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

/** Also used by catalog-schemas.service.ts to validate a section exists before creating/publishing a schema version. */
export async function getCatalogSectionRow(id: string) {
  const result = await pool.query(
    `select id, game_id as "itemId", slug, name, status, current_schema_version as "currentSchemaVersion"
     from game_sections where id = $1`,
    [id]
  );
  if (!result.rows[0]) throw notFound("Section not found");
  return result.rows[0] as { id: string; itemId: string; slug: string; name: string; status: CatalogStatus; currentSchemaVersion: number | null };
}
