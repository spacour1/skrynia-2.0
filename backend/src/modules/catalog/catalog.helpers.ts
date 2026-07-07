import crypto from "node:crypto";
import { pool, type DbClient } from "../../db/pool.js";
import { badRequest } from "../../common/errors.js";

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
export function assertSlugEditable(currentStatus: CatalogStatus, currentSlug: string, nextSlug: string | undefined) {
  if (nextSlug !== undefined && nextSlug !== currentSlug && currentStatus !== "draft") {
    throw badRequest("Slug can only be changed while status is draft");
  }
}

export function buildDynamicUpdate(id: string, fields: Record<string, unknown>) {
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
export function statusChangeActionType(targetKind: "group" | "item" | "section", previousStatus: string, input: { status?: string }): string {
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
