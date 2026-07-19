import { Redis } from "ioredis";
import { env } from "../config/env.js";

let redis: Redis | null = null;

export function getRedis() {
  if (!env.REDIS_URL) return null;
  if (!redis) {
    redis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      lazyConnect: true
    });
    redis.on("error", (error: Error) => {
      if (env.NODE_ENV !== "test") {
        console.warn("Redis unavailable:", error.message);
      }
    });
  }
  return redis;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const client = getRedis();
  if (!client) return null;
  try {
    const value = await client.get(key);
    return value ? (JSON.parse(value) as T) : null;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number) {
  const client = getRedis();
  if (!client) return;
  try {
    await client.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch {
    // Redis is an optimization for this MVP; core flows remain database-backed.
  }
}

async function deleteCacheKeys(strict: boolean, keys: string[]) {
  const client = getRedis();
  if (!client || keys.length === 0) return;
  try {
    await client.del(...keys);
  } catch (error) {
    if (strict) throw error;
    // Cache invalidation is best-effort.
  }
}

export async function cacheDel(...keys: string[]) {
  await deleteCacheKeys(false, keys);
}

export async function cacheDelStrict(...keys: string[]) {
  await deleteCacheKeys(true, keys);
}

async function deleteCachePattern(pattern: string, strict: boolean) {
  const client = getRedis();
  if (!client) return;
  try {
    const stream = client.scanStream({ match: pattern, count: 100 });
    for await (const keys of stream) {
      const batch = keys as string[];
      if (batch.length) await client.del(...batch);
    }
  } catch (error) {
    if (strict) throw error;
    // Cache invalidation is best-effort.
  }
}

export async function cacheDelPattern(pattern: string) {
  await deleteCachePattern(pattern, false);
}

export async function cacheDelPatternStrict(pattern: string) {
  await deleteCachePattern(pattern, true);
}

async function deleteCachePrefixes(prefixes: string[], strict: boolean) {
  const client = getRedis();
  const uniquePrefixes = [...new Set(prefixes.filter(Boolean))];
  if (!client || uniquePrefixes.length === 0) return;
  try {
    // One keyspace pass is materially cheaper than one SCAN per product when a seller
    // with many listings is banned. Marketplace invalidation only uses prefix namespaces,
    // so filtering the returned batches locally preserves the same semantics as MATCH.
    const stream = client.scanStream({ count: 250 });
    for await (const keys of stream) {
      const matching = (keys as string[]).filter((key) =>
        uniquePrefixes.some((prefix) => key.startsWith(prefix))
      );
      if (matching.length) await client.del(...matching);
    }
  } catch (error) {
    if (strict) throw error;
    // Cache invalidation is best-effort.
  }
}

export async function cacheDelPrefixes(...prefixes: string[]) {
  await deleteCachePrefixes(prefixes, false);
}

export async function cacheDelPrefixesStrict(...prefixes: string[]) {
  await deleteCachePrefixes(prefixes, true);
}
