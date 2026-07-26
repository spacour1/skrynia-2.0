import { apiFetch } from "./api";

export type CursorItemsPage<K extends string, T> = Record<K, T[]> & {
  nextCursor: string | null;
};

export function cursorPagePath(path: string, cursor: string | null, limit = 25): string {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  return `${path}${path.includes("?") ? "&" : "?"}${params.toString()}`;
}

/**
 * Membership caches (favorite IDs, blocked IDs) need the complete set to answer
 * a boolean for any card currently on screen. The API still performs only bounded
 * keyset queries; this helper follows their opaque cursors one page at a time.
 */
export async function fetchAllCursorItems<K extends string, T>(
  path: string,
  key: K
): Promise<T[]> {
  const items: T[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;

  do {
    const page: CursorItemsPage<K, T> = await apiFetch<CursorItemsPage<K, T>>(
      cursorPagePath(path, cursor, 100)
    );
    items.push(...page[key]);
    if (!page.nextCursor) break;
    if (seenCursors.has(page.nextCursor)) {
      throw new Error("Pagination cursor repeated");
    }
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  } while (cursor);

  return items;
}
