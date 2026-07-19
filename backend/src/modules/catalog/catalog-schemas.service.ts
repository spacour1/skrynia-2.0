import { inTx, pool, type DbClient } from "../../db/pool.js";
import { badRequest, notFound } from "../../common/errors.js";
import { parseCatalogSchema, validateMetadataAgainstSchema, type CatalogSchema } from "./catalog.validation.js";
import { recordCatalogAudit } from "./catalog.helpers.js";
import { getCatalogSectionRow } from "./catalog-sections.service.js";

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
  rawMetadata: Record<string, unknown>,
  db: DbClient = pool
): Promise<{ metadata: Record<string, unknown>; schemaVersion: number | null }> {
  if (!sectionId) return { metadata: rawMetadata, schemaVersion: null };

  const result = await db.query(
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
  schemaVersion: number;
};

/**
 * The only place that decides whether a section is actually open for new/updated lots:
 * its own status, its parent item's status, its parent group's status, and whether it has
 * a published (active) schema must all check out. Used by both create and update so a lot
 * can never be attached to a section that isn't fully live, regardless of which route it
 * comes through.
 */
export async function resolveActiveSectionChain(
  sectionId: string,
  db: DbClient = pool,
  options: { lock?: boolean } = {}
): Promise<ActiveSectionChain> {
  const result = await db.query(
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
     where gs.id = $1
     ${options.lock ? "for share of gs, g, cg" : ""}`,
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
    allowedDeliveryTypes: row.allowedDeliveryTypes,
    schemaVersion: row.currentSchemaVersion
  };
}
