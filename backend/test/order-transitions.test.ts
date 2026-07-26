import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ORDER_STATUSES, type OrderStatus } from "../src/domain/enums.js";
import {
  assertOrderTransition,
  canTransitionOrder,
  ORDER_TRANSITIONS
} from "../src/modules/orders/order-transitions.js";
import { getRedis } from "../src/common/redis.js";
import { inTx, pool } from "../src/db/pool.js";
import { lockEscrow, refundEscrow, releaseEscrow } from "../src/modules/orders/ledger.service.js";
import {
  transitionOrder,
  type TransitionOrderInput
} from "../src/modules/orders/order-transition.service.js";
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
        if (expected) {
          expect(() => assertOrderTransition(from, to)).not.toThrow();
        } else {
          expect(() => assertOrderTransition(from, to)).toThrow(
            `Order cannot transition from ${from} to ${to}`
          );
        }
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

describe("centralized transitionOrder service", () => {
  async function plainOrder(status: OrderStatus = "pending") {
    const buyer = await createUser();
    const seller = await createUser();
    const productId = await createProduct(seller);
    const orderId = await createOrder(buyer, seller, productId, { status });
    return { buyer, seller, productId, orderId };
  }

  async function runTransition(input: TransitionOrderInput) {
    return inTx((client) => transitionOrder(client, input));
  }

  it("owns lifecycle timestamps, the event, and the established outbox contracts", async () => {
    const { buyer, seller, orderId } = await plainOrder();
    const admin = await createUser("admin");

    const paid = await runTransition({
      orderId,
      to: "paid",
      actor: { kind: "user", id: buyer, role: "buyer" },
      reason: "payment_captured",
      expectedFrom: ["pending"],
      metadata: { provider: "manual" }
    });
    expect(paid.paid_at).toBeInstanceOf(Date);
    expect(paid.delivered_at).toBeNull();
    expect(paid.auto_release_at).toBeNull();
    expect(paid.completed_at).toBeNull();

    const started = await runTransition({
      orderId,
      to: "in_progress",
      actor: { kind: "user", id: seller, role: "seller" },
      reason: "seller_started",
      expectedFrom: ["paid"]
    });
    expect(started.paid_at).toEqual(paid.paid_at);

    const delivered = await runTransition({
      orderId,
      to: "delivered",
      actor: { kind: "user", id: seller, role: "seller" },
      reason: "seller_delivered",
      expectedFrom: ["paid", "in_progress"]
    });
    expect(delivered.delivered_at).toBeInstanceOf(Date);
    expect(delivered.auto_release_at).toBeInstanceOf(Date);
    expect(delivered.auto_release_at!.getTime()).toBeGreaterThan(
      delivered.delivered_at!.getTime()
    );

    const disputeId = randomUUID();
    const disputed = await inTx(async (client) => {
      await client.query(
        `insert into disputes(id, order_id, opened_by, reason)
         values ($1, $2, $3, $4)`,
        [disputeId, orderId, buyer, "A sufficiently detailed transition test dispute"]
      );
      return transitionOrder(client, {
        orderId,
        to: "disputed",
        actor: { kind: "user", id: buyer, role: "participant" },
        reason: "dispute_opened",
        expectedFrom: ["paid", "in_progress", "delivered"],
        metadata: {
          disputeId,
          disputeReason: "A sufficiently detailed transition test dispute"
        }
      });
    });
    expect(disputed.auto_release_at).toEqual(delivered.auto_release_at);
    expect(disputed.completed_at).toBeNull();

    const refunded = await runTransition({
      orderId,
      to: "refunded",
      actor: { kind: "user", id: admin, role: "admin" },
      reason: "dispute_refunded",
      expectedFrom: ["disputed"]
    });
    expect(refunded.completed_at).toBeInstanceOf(Date);
    expect(refunded.auto_release_at).toEqual(delivered.auto_release_at);

    const events = await pool.query<{
      type: string;
      templateKey: string;
      transition: {
        from: OrderStatus;
        to: OrderStatus;
        reason: string;
        actor: { kind: string; id: string; role: string };
      };
    }>(
      `select type,
              metadata->>'templateKey' as "templateKey",
              metadata->'transition' as transition
       from order_events
       where order_id = $1
       order by created_at, id`,
      [orderId]
    );
    expect(events.rows.map((event) => event.type)).toEqual([
      "paid",
      "started",
      "delivered",
      "disputed",
      "refunded"
    ]);
    expect(events.rows.map((event) => event.templateKey)).toEqual([
      "orderEvents.paid",
      "orderEvents.started",
      "orderEvents.delivered",
      "orderEvents.disputed",
      "orderEvents.refunded"
    ]);
    expect(events.rows[0].transition).toMatchObject({
      from: "pending",
      to: "paid",
      reason: "payment_captured",
      actor: { kind: "user", id: buyer, role: "buyer" }
    });

    const outbox = await pool.query<{
      eventKey: string;
      eventType: string;
      aggregateType: string;
      aggregateId: string;
    }>(
      `select event_key as "eventKey", event_type as "eventType",
              aggregate_type as "aggregateType", aggregate_id as "aggregateId"
       from domain_outbox
       where payload->>'orderId' = $1
       order by created_at, id`,
      [orderId]
    );
    expect(outbox.rows).toEqual([
      expect.objectContaining({
        eventKey: `order.paid:${orderId}`,
        eventType: "order.paid",
        aggregateType: "order",
        aggregateId: orderId
      }),
      expect.objectContaining({
        eventKey: `order.started:${orderId}`,
        eventType: "order.started"
      }),
      expect.objectContaining({
        eventKey: `order.delivered:${orderId}`,
        eventType: "order.delivered"
      }),
      expect.objectContaining({
        eventKey: `dispute.opened:${disputeId}`,
        eventType: "dispute.opened",
        aggregateType: "dispute",
        aggregateId: disputeId
      }),
      expect.objectContaining({
        eventKey: `order.refunded:${orderId}`,
        eventType: "order.refunded"
      })
    ]);
  });

  it("checks the actor identity and the actor's persisted admin role", async () => {
    const first = await plainOrder("paid");
    const outsider = await createUser();
    const before = await getOrder(first.orderId);

    await expect(
      runTransition({
        orderId: first.orderId,
        to: "in_progress",
        actor: { kind: "user", id: outsider, role: "seller" },
        reason: "seller_started",
        expectedFrom: ["paid"]
      })
    ).rejects.toThrow("Only the seller can perform this order transition");

    const second = await plainOrder("disputed");
    await expect(
      runTransition({
        orderId: second.orderId,
        to: "refunded",
        actor: { kind: "user", id: outsider, role: "admin" },
        reason: "dispute_refunded",
        expectedFrom: ["disputed"]
      })
    ).rejects.toThrow("Only an admin can perform this order transition");

    const third = await plainOrder("paid");
    await expect(
      runTransition({
        orderId: third.orderId,
        to: "disputed",
        actor: { kind: "user", id: outsider, role: "participant" },
        reason: "dispute_opened",
        expectedFrom: ["paid"],
        metadata: {
          disputeId: randomUUID(),
          disputeReason: "An outsider cannot open this order dispute"
        }
      })
    ).rejects.toThrow("Only an order participant can perform this transition");

    const after = await getOrder(first.orderId);
    expect(after.status).toBe(before.status);
    expect(after.updated_at).toEqual(before.updated_at);
    expect(
      (
        await pool.query(
          `select id from order_events
           where order_id = any($1::uuid[])`,
          [[first.orderId, second.orderId, third.orderId]]
        )
      ).rows
    ).toHaveLength(0);
    expect(
      (
        await pool.query(
          `select id from domain_outbox
           where payload->>'orderId' = any($1::text[])`,
          [[first.orderId, second.orderId, third.orderId]]
        )
      ).rows
    ).toHaveLength(0);
  });

  it("serializes conflicting transitions and emits one event/outbox intent", async () => {
    const { orderId } = await plainOrder("delivered");
    const completed: TransitionOrderInput = {
      orderId,
      to: "completed",
      actor: { kind: "service", id: "escrow-service", role: "system" },
      reason: "service_released",
      expectedFrom: ["delivered"]
    };
    const refunded: TransitionOrderInput = {
      orderId,
      to: "refunded",
      actor: { kind: "service", id: "escrow-service", role: "system" },
      reason: "service_refunded",
      expectedFrom: ["delivered"]
    };

    const results = await Promise.allSettled([
      runTransition(completed),
      runTransition(refunded)
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);

    expect(["completed", "refunded"]).toContain((await getOrder(orderId)).status);
    expect(
      (
        await pool.query(
          `select id from order_events
           where order_id = $1 and type in ('completed', 'refunded')`,
          [orderId]
        )
      ).rows
    ).toHaveLength(1);
    expect(
      (
        await pool.query(
          `select id from domain_outbox
           where event_key in ($1, $2)`,
          [`order.completed:${orderId}`, `order.refunded:${orderId}`]
        )
      ).rows
    ).toHaveLength(1);
  });

  it("treats an exact committed retry as idempotent without duplicate evidence", async () => {
    const { buyer, orderId } = await plainOrder();
    const input: TransitionOrderInput = {
      orderId,
      to: "canceled",
      actor: { kind: "service", id: buyer, role: "test_payment" },
      reason: "test_payment_failed",
      expectedFrom: ["pending"]
    };

    const first = await runTransition(input);
    const retried = await runTransition(input);
    expect(retried.id).toBe(first.id);
    expect(retried.updated_at).toEqual(first.updated_at);
    expect(
      (
        await pool.query(
          `select id from order_events
           where order_id = $1 and type = 'canceled'`,
          [orderId]
        )
      ).rows
    ).toHaveLength(1);
    expect(
      (
        await pool.query(
          `select id from domain_outbox
           where event_key = $1`,
          [`order.canceled:${orderId}`]
        )
      ).rows
    ).toHaveLength(1);
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
