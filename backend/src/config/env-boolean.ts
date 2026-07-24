import { z } from "zod";

/**
 * Strict parser for boolean environment variables.
 *
 * Environment variables arrive as strings, while tests and programmatic callers
 * may supply actual booleans. Do not use `z.coerce.boolean()` here: JavaScript's
 * Boolean("false") is `true`.
 */
export const strictBooleanEnvSchema = z.preprocess((value) => {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return value;

  switch (value.trim().toLowerCase()) {
    case "true":
    case "1":
      return true;
    case "false":
    case "0":
      return false;
    default:
      return value;
  }
}, z.boolean());
