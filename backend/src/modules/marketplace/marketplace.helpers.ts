import { pool } from "../../db/pool.js";
import { isUserOnline } from "../chat/ws.service.js";
import type { CatalogSchema } from "../catalog/catalog.validation.js";

export function addSellerPresence<T extends { sellerId?: string }>(rows: T[]) {
  return rows.map((row) => ({
    ...row,
    sellerOnline: row.sellerId ? isUserOnline(row.sellerId) : false
  }));
}

/**
 * Attaches `cardMetadata` (label + value for each `showInCard: true` schema field) to a
 * batch of product rows in one extra query, keyed by (sectionId, schemaVersion) - not a
 * per-row lookup, so listing a page of products never turns into N+1 schema fetches.
 * Products without a section/schema_version (legacy sectionless lots) get an empty array.
 */
export async function attachCardMetadata<T extends { sectionId?: string | null; schemaVersion?: number | null; metadata?: Record<string, unknown> }>(
  rows: T[]
): Promise<(T & { cardMetadata: { key: string; label: string; value: unknown }[] })[]> {
  const sectionIds = Array.from(new Set(rows.map((row) => row.sectionId).filter((id): id is string => Boolean(id))));
  const schemaByKey = new Map<string, CatalogSchema>();
  if (sectionIds.length) {
    const schemasResult = await pool.query(
      `select section_id as "sectionId", version, schema from catalog_section_schemas where section_id = any($1::uuid[])`,
      [sectionIds]
    );
    for (const row of schemasResult.rows) {
      schemaByKey.set(`${row.sectionId}:${row.version}`, row.schema as CatalogSchema);
    }
  }

  return rows.map((row) => {
    const schema = row.sectionId && row.schemaVersion ? schemaByKey.get(`${row.sectionId}:${row.schemaVersion}`) : undefined;
    const cardMetadata = schema
      ? schema.fields
          .filter((field) => field.showInCard)
          .map((field) => ({ key: field.key, label: field.label, value: row.metadata?.[field.key] }))
          .filter((entry) => entry.value !== undefined && entry.value !== null && entry.value !== "")
      : [];
    return { ...row, cardMetadata };
  });
}

/**
 * Builds an `update ... set col = $n, ...` clause distinguishing three states:
 * undefined leaves the column untouched, null clears it, any other value overwrites it.
 */
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
