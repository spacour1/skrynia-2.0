import { pool } from "../../db/pool.js";
import { notFound } from "../../common/errors.js";
import { assertSlugEditable, assertValidSlug, assertValidStatus, buildDynamicUpdate, recordCatalogAudit, statusChangeActionType, type CatalogStatus } from "./catalog.helpers.js";

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
