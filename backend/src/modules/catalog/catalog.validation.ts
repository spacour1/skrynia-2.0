import { z } from "zod";
import { badRequest } from "../../common/errors.js";

const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

export const CATALOG_FIELD_TYPES = ["text", "textarea", "number", "select", "multiselect", "boolean", "checkbox"] as const;
export type CatalogFieldType = (typeof CATALOG_FIELD_TYPES)[number];

const catalogFieldSchema = z
  .object({
    key: z.string().regex(KEY_PATTERN, "must be lowercase latin letters, digits, and underscores, and not start with a digit"),
    label: z.string().min(1),
    type: z.enum(CATALOG_FIELD_TYPES),
    required: z.boolean(),
    placeholder: z.string().optional(),
    helpText: z.string().optional(),
    options: z.array(z.string().min(1)).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    filterable: z.boolean(),
    showInCard: z.boolean(),
    sortOrder: z.number()
  })
  .strict();

export type CatalogField = z.infer<typeof catalogFieldSchema>;

const catalogSchemaSchema = z.object({
  fields: z.array(catalogFieldSchema)
});

export type CatalogSchema = z.infer<typeof catalogSchemaSchema>;

/**
 * Validates an admin-submitted schema definition (the shape of the fields themselves, not
 * product metadata). Thrown messages match the plain badRequest() convention used by every
 * other admin route in the project - no i18n here, same as elsewhere in the API.
 */
export function parseCatalogSchema(input: unknown): CatalogSchema {
  const result = catalogSchemaSchema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    const key = typeof issue?.path?.[1] === "number" && typeof input === "object" && input && "fields" in input
      ? ((input as { fields?: unknown[] }).fields?.[issue.path[1] as number] as { key?: string } | undefined)?.key
      : undefined;
    throw badRequest(`Invalid schema: ${key ? `field "${key}"` : "field"} ${issue?.message ?? "is invalid"}`);
  }

  const seenKeys = new Set<string>();
  for (const field of result.data.fields) {
    if (seenKeys.has(field.key)) {
      throw badRequest(`Invalid schema: field key "${field.key}" must be unique`);
    }
    seenKeys.add(field.key);

    if ((field.type === "select" || field.type === "multiselect") && (!field.options || field.options.length === 0)) {
      throw badRequest(`Invalid schema: select field "${field.key}" must have options`);
    }
    if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
      throw badRequest(`Invalid schema: field "${field.key}" min must not exceed max`);
    }
  }

  return result.data;
}

/**
 * Validates + filters a lot's submitted metadata against the section's active schema.
 * Unknown keys (not declared in the schema) are silently dropped rather than rejected -
 * the schema is the source of truth for what gets stored, not a strict allowlist error.
 * Frontend never gets to decide what's valid here; this is the only place that does.
 */
export function validateMetadataAgainstSchema(schema: CatalogSchema, rawMetadata: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};

  for (const field of schema.fields) {
    const value = rawMetadata[field.key];
    const isEmpty = value === undefined || value === null || value === "";

    if (field.required && isEmpty) {
      throw badRequest(`Invalid metadata: ${field.key} is required`);
    }
    if (isEmpty) continue;

    switch (field.type) {
      case "number": {
        if (typeof value !== "number" || Number.isNaN(value)) {
          throw badRequest(`Invalid metadata: ${field.key} must be a number`);
        }
        if (field.min !== undefined && value < field.min) {
          throw badRequest(`Invalid metadata: ${field.key} must be at least ${field.min}`);
        }
        if (field.max !== undefined && value > field.max) {
          throw badRequest(`Invalid metadata: ${field.key} must be at most ${field.max}`);
        }
        clean[field.key] = value;
        break;
      }
      case "boolean":
      case "checkbox": {
        if (typeof value !== "boolean") {
          throw badRequest(`Invalid metadata: ${field.key} must be a boolean`);
        }
        clean[field.key] = value;
        break;
      }
      case "select": {
        if (typeof value !== "string" || !(field.options ?? []).includes(value)) {
          throw badRequest(`Invalid metadata: ${field.key} must be one of the allowed options`);
        }
        clean[field.key] = value;
        break;
      }
      case "multiselect": {
        if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && (field.options ?? []).includes(item))) {
          throw badRequest(`Invalid metadata: ${field.key} must be an array of allowed options`);
        }
        clean[field.key] = value;
        break;
      }
      case "text":
      case "textarea": {
        if (typeof value !== "string") {
          throw badRequest(`Invalid metadata: ${field.key} must be a string`);
        }
        clean[field.key] = value;
        break;
      }
    }
  }

  return clean;
}

/**
 * Builds SQL WHERE clause fragments + parameter values for `meta[key]=value` /
 * `meta[key][min|max]=value` product-list filters, validated against a section's active
 * schema. Every key must both exist on the schema and be `filterable: true` - unknown or
 * non-filterable keys are a hard error (never silently ignored), so a stale/buggy frontend
 * finds out immediately rather than a filter silently doing nothing. Empty values are
 * skipped (an empty string means "no filter for this field", not "filter for empty").
 *
 * Field keys are safe to interpolate directly into the SQL text: they're only ever taken
 * from `schema.fields` (validated by KEY_PATTERN at schema-creation time - lowercase
 * letters/digits/underscore only), never from the raw query key itself.
 */
export function buildMetadataFilterClauses(
  schema: CatalogSchema,
  metaQuery: Record<string, unknown>,
  startParamIndex: number
): { clauses: string[]; values: unknown[] } {
  const fieldsByKey = new Map(schema.fields.map((field) => [field.key, field]));
  const clauses: string[] = [];
  const values: unknown[] = [];
  let paramIndex = startParamIndex;

  for (const [key, rawValue] of Object.entries(metaQuery)) {
    if (rawValue === undefined || rawValue === null || rawValue === "") continue;
    const field = fieldsByKey.get(key);
    if (!field || !field.filterable) {
      throw badRequest(`Unknown or non-filterable metadata filter: ${key}`);
    }

    if (field.type === "number") {
      if (typeof rawValue !== "object" || Array.isArray(rawValue)) {
        throw badRequest(`Invalid filter for ${key}: expected {min, max}`);
      }
      const { min, max } = rawValue as { min?: string; max?: string };
      if (min !== undefined && min !== "") {
        if (Number.isNaN(Number(min))) throw badRequest(`Invalid filter for ${key}: min must be a number`);
        paramIndex += 1;
        clauses.push(`(p.metadata->>'${key}')::numeric >= $${paramIndex}`);
        values.push(Number(min));
      }
      if (max !== undefined && max !== "") {
        if (Number.isNaN(Number(max))) throw badRequest(`Invalid filter for ${key}: max must be a number`);
        paramIndex += 1;
        clauses.push(`(p.metadata->>'${key}')::numeric <= $${paramIndex}`);
        values.push(Number(max));
      }
      continue;
    }

    if (typeof rawValue !== "string") {
      throw badRequest(`Invalid filter for ${key}`);
    }

    if (field.type === "boolean" || field.type === "checkbox") {
      if (rawValue !== "true" && rawValue !== "false") throw badRequest(`Invalid filter for ${key}: expected true or false`);
      paramIndex += 1;
      clauses.push(`(p.metadata->>'${key}')::boolean = $${paramIndex}`);
      values.push(rawValue === "true");
    } else if (field.type === "multiselect") {
      paramIndex += 1;
      clauses.push(`p.metadata->'${key}' @> to_jsonb($${paramIndex}::text)`);
      values.push(rawValue);
    } else {
      // select / text / textarea: exact match
      paramIndex += 1;
      clauses.push(`p.metadata->>'${key}' = $${paramIndex}`);
      values.push(rawValue);
    }
  }

  return { clauses, values };
}
