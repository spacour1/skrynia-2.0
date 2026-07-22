import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ORDER_STATUSES, type OrderStatus } from "../src/domain/enums.js";
import { canTransitionOrder, ORDER_TRANSITIONS } from "../src/modules/orders/order-transitions.js";
import { getRedis } from "../src/common/redis.js";
import { pool } from "../src/db/pool.js";
import { lockEscrow, refundEscrow, releaseEscrow } from "../src/modules/orders/ledger.service.js";
import {
  closeDb,
  createOrder,
  createProduct,
  createUser,
  getOrder,
  resetDb
} from "./fixtures.js";

beforeEach(resetDb);
afterAll(async () => {
  await getRedis()?.quit();
  await closeDb();
});

const EXPECTED: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ["paid", "delivered", "canceled"],
  paid: ["in_progress", "delivered", "disputed", "refunded"],
  in_progress: ["delivered", "disputed", "refunded"],
  delivered: ["completed", "disputed", "refunded"],
  disputed: ["completed", "refunded"],
  completed: [],
  refunded: [],
  canceled: []
};

describe("order transition matrix", () => {
  it("matches the documented graph for every (from, to) pair", () => {
    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) {
        const expected = EXPECTED[from].includes(to);
        expect(
          canTransitionOrder(from, to),
          `${from} -> ${to} should be ${expected ? "allowed" : "forbidden"}`
        ).toBe(expected);
      }
    }
  });

  it("every terminal status has no outgoing transitions", () => {
    for (const terminal of ["completed", "refunded", "canceled"] as const) {
      expect(ORDER_TRANSITIONS[terminal]).toEqual([]);
      for (const to of ORDER_STATUSES) {
        expect(canTransitionOrder(terminal, to)).toBe(false);
      }
    }
  });

  it("no status transitions to itself", () => {
    for (const status of ORDER_STATUSES) {
      expect(canTransitionOrder(status, status)).toBe(false);
    }
  });
});

describe("order transitions enforced by real money-moving services", () => {
  async function escrowedOrder(status: "paid" | "in_progress" | "delivered" | "disputed" = "paid") {
    const buyer = await createUser();
    const seller = await createUser();
    const product = await createProduct(seller, { priceCents: 2000 });
    const orderId = await createOrder(buyer, seller, product, { amountCents: 2000 });
    await lockEscrow(orderId, buyer, "mock");
    if (status !== "paid") {
      await pool.query(`update orders set status = $2, updated_at = now() where id = $1`, [orderId, status]);
    }
    return { orderId, buyer, seller };
  }

  it("forbidden transition (pending -> paid twice) does not change the DB", async () => {
    const { orderId } = await escrowedOrder("paid");
    const before = await getOrder(orderId);
    await expect(lockEscrow(orderId, before.buyer_id, "mock")).rejects.toThrow();
    const after = await getOrder(orderId);
    expect(after.status).toBe(before.status);
    expect(after.updated_at).toEqual(before.updated_at);
  });

  it("releaseEscrow only succeeds from delivered/disputed (matrix-backed)", async () => {
    const { orderId: fromPaid } = await escrowedOrder("paid");
    await expect(releaseEscrow(fromPaid)).rejects.toThrow(
      "Only delivered or disputed orders can be released"
    );

    const { orderId: fromDelivered } = await escrowedOrder("delivered");
    const released = await releaseEscrow(fromDelivered);
    expect(released.status).toBe("completed");

    const { orderId: fromDisputed } = await escrowedOrder("disputed");
    const releasedFromDispute = await releaseEscrow(fromDisputed);
    expect(releasedFromDispute.status).toBe("completed");
  });

  it("refundEscrow succeeds from every escrowed status and rejects terminal ones", async () => {
    for (const status of ["paid", "in_progress", "delivered", "disputed"] as const) {
      const { orderId } = await escrowedOrder(status);
      const refunded = await refundEscrow(orderId);
      expect(refunded.status).toBe("refunded");
    }

    const { orderId: alreadyRefunded } = await escrowedOrder("paid");
    await refundEscrow(alreadyRefunded);
    await expect(refundEscrow(alreadyRefunded)).rejects.toThrow(
      "Only escrowed orders can be refunded"
    );
  });

  it("concurrent releaseEscrow and refundEscrow on the same order serialize to one winner", async () => {
    const { orderId } = await escrowedOrder("delivered");
    const results = await Promise.allSettled([releaseEscrow(orderId), refundEscrow(orderId)]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const final = await getOrder(orderId);
    expect(["completed", "refunded"]).toContain(final.status);
  });
});
