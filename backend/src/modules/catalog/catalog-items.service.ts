import { pool } from "../../db/pool.js";
import { badRequest, notFound } from "../../common/errors.js";
import { assertSlugEditable, assertValidSlug, assertValidStatus, buildDynamicUpdate, recordCatalogAudit, statusChangeActionType, type CatalogStatus } from "./catalog.helpers.js";

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
