import { z } from "zod";
import { badRequest } from "./errors.js";

export const DEFAULT_PAGE_LIMIT = 25;
export const MAX_PAGE_LIMIT = 100;

export type DecodedCursor = { createdAt: string; id: string };

const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).optional(),
  cursor: z.string().optional()
});

/**
 * Opaque keyset cursor over `(created_at desc, id desc)` — the one stable sort every
 * paginated list in this codebase uses. Base64-encoding two plain fields (not a JWT or
 * signed token: cursors are not secrets, just a resume point) keeps the wire format a
 * single string the client round-trips without inspecting.
 */
export function encodeCursor(createdAt: Date | string, id: string): string {
  const iso = typeof createdAt === "string" ? createdAt : createdAt.toISOString();
  return Buffer.from(`${iso}|${id}`, "utf8").toString("base64url");
}

export function decodeCursor(raw: string): DecodedCursor {
  let decoded: string;
  try {
    decoded = Buffer.from(raw, "base64url").toString("utf8");
  } catch {
    throw badRequest("Invalid pagination cursor");
  }
  const separatorIndex = decoded.lastIndexOf("|");
  if (separatorIndex === -1) throw badRequest("Invalid pagination cursor");
  const createdAt = decoded.slice(0, separatorIndex);
  const id = decoded.slice(separatorIndex + 1);
  if (!id || Number.isNaN(Date.parse(createdAt))) throw badRequest("Invalid pagination cursor");
  return { createdAt, id };
}

export type CursorPage = { limit: number; cursor: DecodedCursor | null };

/** Parses `?limit=&cursor=` from a request query, bounding limit and decoding the cursor. */
export function parseCursorPage(query: unknown): CursorPage {
  const parsed = pageQuerySchema.parse(query);
  return {
    limit: parsed.limit ?? DEFAULT_PAGE_LIMIT,
    cursor: parsed.cursor ? decodeCursor(parsed.cursor) : null
  };
}

/**
 * SQL fragment for `(created_at, id) < (cursor_created_at, cursor_id)` under a
 * `created_at desc, id desc` sort — the standard keyset-pagination predicate, safe
 * against duplicate timestamps because id is a total tiebreaker. Appends the two
 * cursor values to `values` and returns the fragment to AND into the query's WHERE.
 * Returns "" (no-op) when there is no cursor.
 */
export function keysetWhereClause(
  values: unknown[],
  cursor: DecodedCursor | null,
  createdAtColumn: string,
  idColumn: string
): string {
  if (!cursor) return "";
  values.push(cursor.createdAt, cursor.id);
  const createdAtParam = values.length - 1;
  const idParam = values.length;
  return `(${createdAtColumn}, ${idColumn}) < ($${createdAtParam}, $${idParam})`;
}

/**
 * Builds the `nextCursor` for a page: null when the page came back short (no more
 * rows), otherwise the cursor for the last row under the shared sort order.
 */
export function buildNextCursor<T extends { createdAt: Date | string; id: string }>(
  rows: T[],
  limit: number
): string | null {
  if (rows.length < limit) return null;
  const last = rows[rows.length - 1];
  return encodeCursor(last.createdAt, last.id);
}
