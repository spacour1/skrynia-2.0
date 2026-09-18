import {
  cacheDel,
  cacheDelPrefixes,
  cacheDelPrefixesStrict,
  cacheDelStrict,
  getRedis
} from "../../common/redis.js";
import { pool } from "../../db/pool.js";
import type { DbClient } from "../../db/pool.js";
import { publicProductEligibilitySql } from "./marketplace.sql.js";

export type ProductCacheContext = {
  productId: string;
  sellerId?: string;
  gameId?: string | null;
  categoryId?: string | null;
  sectionId?: string | null;
};

export type MarketplaceCacheScope = {
  sellerIds?: readonly string[];
  gameIds?: readonly string[];
  categoryIds?: readonly string[];
  sectionIds?: readonly string[];
};

type MarketplaceCacheInvalidationOptions = {
  strict?: boolean;
};

export type MarketplaceCacheSnapshot = {
  generation: string | null;
};

const MARKETPLACE_CACHE_GENERATION_KEY = "marketplace:cache:generation";

type GenerationCacheEntry<T> = {
  v: 1;
  generation: string;
  value: T;
};

const PRODUCT_CACHE_CONTEXT_COLUMNS = `
  id as "productId",
  seller_id as "sellerId",
  game_id as "gameId",
  category_id as "categoryId",
  section_id as "sectionId"
`;

function compactIds(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

/** Redis can reconnect with entries whose post-commit invalidation was lost. Never
 * use cache freshness as authorization to disclose moderated content. This bounded
 * primary-key check also covers a process crash between commit and invalidation. */
async function cachedContentIsPublic(key: string, value: unknown): Promise<boolean> {
  if (key === "marketplace:games") {
    if (!Array.isArray(value) || value.length > 500) return false;
    const ids = value.map((row) => row?.id);
    const visible = await pool.query<{ id: string }>(
      `select g.id from games g
       join catalog_groups cg on cg.id = g.group_id and cg.status = 'active'
       where g.id = any($1::uuid[]) and g.status = 'active'`,
      [ids]
    );
    return visible.rows.length === ids.length;
  }
  const detail = key.startsWith("marketplace:product:");
  if (!detail && !key.startsWith("marketplace:products:")) return true;
  if (!value || typeof value !== "object") return false;
  const payload = value as { product?: unknown; products?: unknown };
  const items = detail ? [payload.product] : payload.products;
  if (!Array.isArray(items) || items.length > 100) return false;
  const ids = items.map((item) => item?.id);
  const visible = await pool.query<{ id: string; mediaIds: string[] }>(
    `select p.id, array(
       select pm.id::text from product_media pm
       where pm.product_id = p.id and pm.status = 'approved'
     ) as "mediaIds"
     from products p join users u on u.id = p.seller_id
     where p.id = any($1::uuid[]) and p.status = 'active'
       and u.is_banned = false and ${publicProductEligibilitySql("p")}`,
    [ids]
  );
  if (visible.rows.length !== ids.length) return false;
  const allowedMedia = new Map(visible.rows.map((row) => [row.id, new Set(row.mediaIds)]));
  return items.every((item) => Array.isArray(item.media) && item.media.every(
    (media: { id?: string }) => typeof media.id === "string" && allowedMedia.get(item.id)?.has(media.id)
  ));
}

/**
 * Reads the namespace generation and cache entry in one Redis command. Entries from an
 * older generation are misses even if a prefix sweep has not reached them yet.
 */
export async function readMarketplaceCache<T>(key: string): Promise<{
  value: T | null;
  snapshot: MarketplaceCacheSnapshot;
}> {
  const client = getRedis();
  if (!client) return { value: null, snapshot: { generation: null } };
  try {
    const [rawGeneration, rawEntry] = await client.mget(
      MARKETPLACE_CACHE_GENERATION_KEY,
      key
    );
    const generation = rawGeneration ?? "0";
    if (!rawEntry) return { value: null, snapshot: { generation } };
    const entry = JSON.parse(rawEntry) as Partial<GenerationCacheEntry<T>> | null;
    if (
      !entry ||
      typeof entry !== "object" ||
      entry.v !== 1 ||
      entry.generation !== generation ||
      !("value" in entry)
    ) {
      return { value: null, snapshot: { generation } };
    }
    if (!await cachedContentIsPublic(key, entry.value)) {
      return { value: null, snapshot: { generation } };
    }
    return { value: entry.value as T, snapshot: { generation } };
  } catch {
    return { value: null, snapshot: { generation: null } };
  }
}

/** Writes only if no committed invalidation advanced the namespace meanwhile. */
export async function setMarketplaceCacheIfCurrent(
  key: string,
  value: unknown,
  ttlSeconds: number,
  snapshot: MarketplaceCacheSnapshot
): Promise<boolean> {
  const client = getRedis();
  if (!client || snapshot.generation === null) return false;
  try {
    const entry: GenerationCacheEntry<unknown> = {
      v: 1,
      generation: snapshot.generation,
      value
    };
    const written = await client.eval(
      `local generation = redis.call('GET', KEYS[1]) or '0'
       if generation ~= ARGV[1] then return 0 end
       redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3])
       return 1`,
      2,
      MARKETPLACE_CACHE_GENERATION_KEY,
      key,
      snapshot.generation,
      JSON.stringify(entry),
      String(ttlSeconds)
    );
    return Number(written) === 1;
  } catch {
    return false;
  }
}

async function advanceMarketplaceCacheGeneration(strict: boolean) {
  const client = getRedis();
  if (!client) return;
  try {
    await client.incr(MARKETPLACE_CACHE_GENERATION_KEY);
  } catch (error) {
    if (strict) throw error;
  }
}

async function deleteExactKeys(keys: string[], strict: boolean) {
  const uniqueKeys = [...new Set(keys)];
  const deleteKeys = strict ? cacheDelStrict : cacheDel;
  for (let offset = 0; offset < uniqueKeys.length; offset += 500) {
    await deleteKeys(...uniqueKeys.slice(offset, offset + 500));
  }
}

export async function loadProductCacheContext(productId: string) {
  const result = await pool.query<ProductCacheContext>(
    `select ${PRODUCT_CACHE_CONTEXT_COLUMNS} from products where id = $1`,
    [productId]
  );
  return result.rows[0] ?? null;
}

export async function loadSellerProductCacheContexts(
  sellerId: string,
  db: DbClient = pool
) {
  const result = await db.query<ProductCacheContext>(
    `select ${PRODUCT_CACHE_CONTEXT_COLUMNS} from products where seller_id = $1`,
    [sellerId]
  );
  return result.rows;
}

export async function loadGameProductCacheContexts(gameId: string) {
  const result = await pool.query<ProductCacheContext>(
    `select ${PRODUCT_CACHE_CONTEXT_COLUMNS} from products where game_id = $1`,
    [gameId]
  );
  return result.rows;
}

export async function loadSectionProductCacheContexts(sectionId: string) {
  const result = await pool.query<ProductCacheContext>(
    `select ${PRODUCT_CACHE_CONTEXT_COLUMNS} from products where section_id = $1`,
    [sectionId]
  );
  return result.rows;
}

export async function invalidateProductCacheBatch(
  contexts: readonly ProductCacheContext[],
  scope: MarketplaceCacheScope = {},
  options: MarketplaceCacheInvalidationOptions = {}
): Promise<void> {
  // Advance first: new reads reject old-generation entries immediately, and requests
  // that started before the commit cannot refill a stale value after this point.
  await advanceMarketplaceCacheGeneration(Boolean(options.strict));
  const productIds = compactIds(contexts.map((context) => context.productId));
  const sellerIds = compactIds([
    ...contexts.map((context) => context.sellerId),
    ...(scope.sellerIds ?? [])
  ]);
  const gameIds = compactIds([
    ...contexts.map((context) => context.gameId),
    ...(scope.gameIds ?? [])
  ]);
  const categoryIds = compactIds([
    ...contexts.map((context) => context.categoryId),
    ...(scope.categoryIds ?? [])
  ]);
  const sectionIds = compactIds([
    ...contexts.map((context) => context.sectionId),
    ...(scope.sectionIds ?? [])
  ]);

  const exactKeys = [
    "marketplace:games",
    "categories",
    ...productIds.map((productId) => `marketplace:product:${productId}`)
  ];
  const prefixes = [
    "marketplace:products:",
    ...sellerIds.map((sellerId) => `seller:${sellerId}:`),
    ...gameIds.map((gameId) => `game:${gameId}:`),
    ...categoryIds.map((categoryId) => `category:${categoryId}:`),
    ...sectionIds.map((sectionId) => `section:${sectionId}:`)
  ];

  const deletePrefixes = options.strict
    ? cacheDelPrefixesStrict
    : cacheDelPrefixes;
  await Promise.all([
    deleteExactKeys(exactKeys, Boolean(options.strict)),
    deletePrefixes(...prefixes)
  ]);
}

export async function invalidateProductCaches(
  context: ProductCacheContext,
  options: MarketplaceCacheInvalidationOptions = {}
): Promise<void> {
  await invalidateProductCacheBatch([context], {}, options);
}

export async function invalidateCatalogCaches(
  scope: MarketplaceCacheScope = {},
  options: MarketplaceCacheInvalidationOptions = {}
): Promise<void> {
  await invalidateProductCacheBatch([], scope, options);
  // A group lifecycle change can hide products across many items at once. Group IDs
  // are not part of product cache contexts, so sweep the bounded cache namespace after
  // the committed catalog mutation instead of leaving already-warmed detail payloads
  // public until their TTL expires.
  const deletePrefixes = options.strict
    ? cacheDelPrefixesStrict
    : cacheDelPrefixes;
  await deletePrefixes("marketplace:product:");
}
