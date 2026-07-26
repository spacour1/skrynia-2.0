import { z } from "zod";
import { badRequest } from "./errors.js";

export const DEFAULT_PAGE_LIMIT = 25;
export const MAX_PAGE_LIMIT = 100;

export type DecodedCursor = { createdAt: string; id: string };

const cursorIdSchema = z.string().uuid();

export type CursorPageOptions = {
  defaultLimit?: number;
  maxLimit?: number;
};

export type OffsetPage = { page: number; limit: number; offset: number };

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
  if (Number.isNaN(Date.parse(createdAt)) || !cursorIdSchema.safeParse(id).success) {
    throw badRequest("Invalid pagination cursor");
  }
  // Preserve sub-millisecond precision emitted by PostgreSQL (`created_at::text`).
  // Normalizing through `Date#toISOString()` truncates microseconds and can make the
  // resume predicate skip every tied row that falls later in that same millisecond.
  return { createdAt, id };
}

export type CursorPage = { limit: number; cursor: DecodedCursor | null };

/** Parses `?limit=&cursor=` from a request query, bounding limit and decoding the cursor. */
export function parseCursorPage(query: unknown, options: CursorPageOptions = {}): CursorPage {
  const maxLimit = options.maxLimit ?? MAX_PAGE_LIMIT;
  const defaultLimit = options.defaultLimit ?? DEFAULT_PAGE_LIMIT;
  const pageQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(maxLimit).optional(),
    cursor: z.string().max(512).optional()
  });
  const parsed = pageQuerySchema.parse(query);
  return {
    limit: parsed.limit ?? defaultLimit,
    cursor: parsed.cursor ? decodeCursor(parsed.cursor) : null
  };
}

/** Stable page/limit fallback for lists whose sort has more than the shared two cursor fields. */
export function parseOffsetPage(query: unknown, options: CursorPageOptions = {}): OffsetPage {
  const maxLimit = options.maxLimit ?? MAX_PAGE_LIMIT;
  const defaultLimit = options.defaultLimit ?? DEFAULT_PAGE_LIMIT;
  const parsed = z.object({
    page: z.coerce.number().int().min(1).max(1_000_000).optional(),
    limit: z.coerce.number().int().min(1).max(maxLimit).optional()
  }).parse(query);
  const page = parsed.page ?? 1;
  const limit = parsed.limit ?? defaultLimit;
  return { page, limit, offset: (page - 1) * limit };
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

/**
 * Builds an exact `nextCursor` for queries that fetch `limit + 1` rows. Unlike
 * `buildNextCursor` (kept for older callers that fetch exactly `limit`), this does
 * not advertise a continuation when the result has exactly one full final page.
 * The cursor always points at the last row returned to the client, never at the
 * look-ahead row.
 */
export function buildLookaheadNextCursor<T extends { createdAt: Date | string; id: string }>(
  rows: T[],
  limit: number
): string | null {
  if (rows.length <= limit) return null;
  const lastVisible = rows[limit - 1];
  return encodeCursor(lastVisible.createdAt, lastVisible.id);
}
