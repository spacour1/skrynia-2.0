import { logger } from "../../common/logger.js";
import {
  cacheDelPrefixesStrict,
  cacheDelStrict
} from "../../common/redis.js";

export type OrderParticipantReadCacheInvalidation = {
  orderId: string;
  buyerId: string;
  sellerId: string;
  invalidateBuyerWallet?: boolean;
  invalidateSellerWallet?: boolean;
};

export type OrderParticipantReadCacheInvalidationOptions = {
  mode?: "best-effort" | "strict";
};

/**
 * Evicts participant-facing order reads after the database mutation has committed.
 *
 * This helper intentionally has no database dependency. Request paths use the default
 * best-effort mode so a Redis outage cannot turn an already committed mutation into a
 * reported failure. The durable outbox uses strict mode so its own retry can repair a
 * missed eviction without affecting the original transaction.
 */
export async function invalidateOrderParticipantReadCaches(
  input: OrderParticipantReadCacheInvalidation,
  options: OrderParticipantReadCacheInvalidationOptions = {}
): Promise<void> {
  const readPrefixes = [
    `order:${input.orderId}:`,
    `orders:${input.buyerId}:`,
    `orders:${input.sellerId}:`
  ];
  const walletKeys = [
    input.invalidateBuyerWallet ? `user:${input.buyerId}:wallet` : null,
    input.invalidateSellerWallet ? `user:${input.sellerId}:wallet` : null
  ].filter((key): key is string => key !== null);

  const operations = [
    {
      scope: "order_reads",
      promise: cacheDelPrefixesStrict(...new Set(readPrefixes))
    },
    ...(walletKeys.length
      ? [
          {
            scope: "wallet_reads",
            promise: cacheDelStrict(...new Set(walletKeys))
          }
        ]
      : [])
  ];
  const results = await Promise.allSettled(
    operations.map((operation) => operation.promise)
  );
  const failures = results.flatMap((result, index) =>
    result.status === "rejected"
      ? [{ scope: operations[index].scope, reason: result.reason }]
      : []
  );

  if (failures.length === 0) return;
  if (options.mode === "strict") {
    if (failures.length === 1) throw failures[0].reason;
    throw new AggregateError(
      failures.map((failure) => failure.reason),
      `Order participant cache invalidation failed: ${failures
        .map((failure) => failure.scope)
        .join(", ")}`
    );
  }

  try {
    logger.warn(
      {
        orderId: input.orderId,
        failedScopes: failures.map((failure) => failure.scope)
      },
      "order_participant_cache_invalidation_failed"
    );
  } catch {
    // Logging must not change best-effort invalidation into a post-commit failure.
  }
}
