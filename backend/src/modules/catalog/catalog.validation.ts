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
