import { cacheDel, cacheDelPrefixes } from "../../common/redis.js";
import { pool } from "../../db/pool.js";

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

async function deleteExactKeys(keys: string[]) {
  const uniqueKeys = [...new Set(keys)];
  for (let offset = 0; offset < uniqueKeys.length; offset += 500) {
    await cacheDel(...uniqueKeys.slice(offset, offset + 500));
  }
}

export async function loadProductCacheContext(productId: string) {
  const result = await pool.query<ProductCacheContext>(
    `select ${PRODUCT_CACHE_CONTEXT_COLUMNS} from products where id = $1`,
    [productId]
  );
  return result.rows[0] ?? null;
}

export async function loadSellerProductCacheContexts(sellerId: string) {
  const result = await pool.query<ProductCacheContext>(
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
  scope: MarketplaceCacheScope = {}
): Promise<void> {
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

  await Promise.all([deleteExactKeys(exactKeys), cacheDelPrefixes(...prefixes)]);
}

export async function invalidateProductCaches(context: ProductCacheContext): Promise<void> {
  await invalidateProductCacheBatch([context]);
}

export async function invalidateCatalogCaches(scope: MarketplaceCacheScope = {}): Promise<void> {
  await invalidateProductCacheBatch([], scope);
}
