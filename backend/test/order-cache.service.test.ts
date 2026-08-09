import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cacheDelPrefixesStrict: vi.fn(),
  cacheDelStrict: vi.fn(),
  loggerWarn: vi.fn()
}));

vi.mock("../src/common/redis.js", () => ({
  cacheDelPrefixesStrict: mocks.cacheDelPrefixesStrict,
  cacheDelStrict: mocks.cacheDelStrict
}));

vi.mock("../src/common/logger.js", () => ({
  logger: { warn: mocks.loggerWarn }
}));

import { invalidateOrderParticipantReadCaches } from "../src/modules/orders/order-cache.service.js";

const participants = {
  orderId: "11111111-1111-4111-8111-111111111111",
  buyerId: "22222222-2222-4222-8222-222222222222",
  sellerId: "33333333-3333-4333-8333-333333333333"
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cacheDelPrefixesStrict.mockResolvedValue(undefined);
  mocks.cacheDelStrict.mockResolvedValue(undefined);
});

describe("invalidateOrderParticipantReadCaches", () => {
  it("always evicts order reads and leaves wallet reads intact for a non-money mutation", async () => {
    await invalidateOrderParticipantReadCaches(participants);

    expect(mocks.cacheDelPrefixesStrict).toHaveBeenCalledOnce();
    expect(mocks.cacheDelPrefixesStrict).toHaveBeenCalledWith(
      `order:${participants.orderId}:`,
      `orders:${participants.buyerId}:`,
      `orders:${participants.sellerId}:`
    );
    expect(mocks.cacheDelStrict).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "payment capture",
      flags: { invalidateBuyerWallet: true, invalidateSellerWallet: true },
      walletKeys: [
        `user:${participants.buyerId}:wallet`,
        `user:${participants.sellerId}:wallet`
      ]
    },
    {
      name: "escrow release",
      flags: { invalidateBuyerWallet: false, invalidateSellerWallet: true },
      walletKeys: [`user:${participants.sellerId}:wallet`]
    },
    {
      name: "escrow refund",
      flags: { invalidateBuyerWallet: true, invalidateSellerWallet: true },
      walletKeys: [
        `user:${participants.buyerId}:wallet`,
        `user:${participants.sellerId}:wallet`
      ]
    }
  ])("evicts the affected wallet reads for $name", async ({ flags, walletKeys }) => {
    await invalidateOrderParticipantReadCaches({ ...participants, ...flags });

    expect(mocks.cacheDelPrefixesStrict).toHaveBeenCalledOnce();
    expect(mocks.cacheDelStrict).toHaveBeenCalledOnce();
    expect(mocks.cacheDelStrict).toHaveBeenCalledWith(...walletKeys);
  });

  it("resolves in best-effort mode when Redis rejects and records only safe context", async () => {
    mocks.cacheDelPrefixesStrict.mockRejectedValueOnce(new Error("redis read eviction failed"));
    mocks.cacheDelStrict.mockRejectedValueOnce(new Error("redis wallet eviction failed"));

    await expect(
      invalidateOrderParticipantReadCaches({
        ...participants,
        invalidateBuyerWallet: true
      })
    ).resolves.toBeUndefined();

    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      {
        orderId: participants.orderId,
        failedScopes: ["order_reads", "wallet_reads"]
      },
      "order_participant_cache_invalidation_failed"
    );
  });

  it("still resolves in best-effort mode when both Redis and the warning logger fail", async () => {
    mocks.cacheDelPrefixesStrict.mockRejectedValueOnce(new Error("redis unavailable"));
    mocks.loggerWarn.mockImplementationOnce(() => {
      throw new Error("logger unavailable");
    });

    await expect(
      invalidateOrderParticipantReadCaches(participants)
    ).resolves.toBeUndefined();
  });

  it("rejects in strict mode after attempting every requested eviction", async () => {
    mocks.cacheDelPrefixesStrict.mockRejectedValueOnce(new Error("redis unavailable"));

    await expect(
      invalidateOrderParticipantReadCaches(
        { ...participants, invalidateSellerWallet: true },
        { mode: "strict" }
      )
    ).rejects.toThrow("redis unavailable");

    expect(mocks.cacheDelPrefixesStrict).toHaveBeenCalledOnce();
    expect(mocks.cacheDelStrict).toHaveBeenCalledOnce();
    expect(mocks.loggerWarn).not.toHaveBeenCalled();
  });
});
