import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.js";
import {
  simulateTestPaymentFailure,
  simulateTestPaymentSuccess,
  simulateTestPaymentWaitAccept
} from "../src/modules/payments/test-payments.service.js";
import {
  closeDb,
  createOrder,
  createProduct,
  createUser,
  getOrder,
  getProduct,
  getWallet,
  resetDb
} from "./fixtures.js";

beforeEach(resetDb);
afterAll(closeDb);

async function waitForBlockedPaymentTransitions(expected: number) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const result = await pool.query<{ count: number }>(
      `select count(*)::int as count
       from pg_stat_activity
       where datname = current_database()
         and wait_event_type = 'Lock'
         and (
           query like '%from orders%where id = $1%for update%'
         )`
    );
    if (result.rows[0].count >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${expected} blocked payment transitions`);
}

describe("simulateTestPaymentSuccess", () => {
  it("locks escrow just like a real mock payment", async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const productId = await createProduct(seller, { priceCents: 2000 });
    const orderId = await createOrder(buyer, seller, productId, { amountCents: 2000 });

    const updated = await simulateTestPaymentSuccess(orderId, buyer);

    expect(updated.status).toBe("paid");
    const sellerWallet = await getWallet(seller);
    expect(Number(sellerWallet.escrow_cents)).toBe(2000);
  });

  it("rejects a second success call on the same order instead of double-crediting escrow", async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const productId = await createProduct(seller, { priceCents: 2000 });
    const orderId = await createOrder(buyer, seller, productId, { amountCents: 2000 });

    await simulateTestPaymentSuccess(orderId, buyer);
    await expect(simulateTestPaymentSuccess(orderId, buyer)).rejects.toThrow("Only pending orders can be paid");

    const sellerWallet = await getWallet(seller);
    expect(Number(sellerWallet.escrow_cents)).toBe(2000);
  });

  it("rejects a buyer simulating payment on someone else's order", async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const intruder = await createUser();
    const productId = await createProduct(seller);
    const orderId = await createOrder(buyer, seller, productId);

    await expect(simulateTestPaymentSuccess(orderId, intruder)).rejects.toThrow();
  });
});

describe("simulateTestPaymentFailure", () => {
  it("cancels a pending order without touching escrow", async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const productId = await createProduct(seller);
    const orderId = await createOrder(buyer, seller, productId);

    const updated = await simulateTestPaymentFailure(orderId, buyer);

    expect(updated.status).toBe("canceled");
    const sellerWallet = await getWallet(seller);
    expect(Number(sellerWallet.escrow_cents)).toBe(0);

    const outbox = await pool.query(
      `select event_type as "eventType", status, payload
       from domain_outbox where event_key = $1`,
      [`order.canceled:${orderId}`]
    );
    expect(outbox.rows).toHaveLength(1);
    expect(outbox.rows[0]).toMatchObject({
      eventType: "order.canceled",
      status: "pending",
      payload: {
        orderId,
        buyerId: buyer,
        sellerId: seller,
        productId
      }
    });
  });

  it("rolls back cancellation when its durable outbox intent cannot be stored", async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const productId = await createProduct(seller);
    const orderId = await createOrder(buyer, seller, productId);

    await pool.query(`drop trigger if exists test_fail_canceled_outbox on domain_outbox`);
    await pool.query(`drop function if exists test_fail_canceled_outbox_insert()`);
    await pool.query(`
      create function test_fail_canceled_outbox_insert() returns trigger as $$
      begin
        if new.event_type = 'order.canceled' then
          raise exception 'canceled outbox unavailable';
        end if;
        return new;
      end;
      $$ language plpgsql
    `);
    await pool.query(`
      create trigger test_fail_canceled_outbox
      before insert on domain_outbox
      for each row execute function test_fail_canceled_outbox_insert()
    `);

    try {
      await expect(simulateTestPaymentFailure(orderId, buyer)).rejects.toThrow(
        "canceled outbox unavailable"
      );
    } finally {
      await pool.query(`drop trigger if exists test_fail_canceled_outbox on domain_outbox`);
      await pool.query(`drop function if exists test_fail_canceled_outbox_insert()`);
    }

    expect((await getOrder(orderId)).status).toBe("pending");
    expect(
      (
        await pool.query(
          `select id from order_events where order_id = $1 and type = 'canceled'`,
          [orderId]
        )
      ).rows
    ).toHaveLength(0);
    expect(
      (
        await pool.query(`select id from domain_outbox where event_key = $1`, [
          `order.canceled:${orderId}`
        ])
      ).rows
    ).toHaveLength(0);
  });

  it("rejects failing an order that was already paid", async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const productId = await createProduct(seller);
    const orderId = await createOrder(buyer, seller, productId);

    await simulateTestPaymentSuccess(orderId, buyer);
    await expect(simulateTestPaymentFailure(orderId, buyer)).rejects.toThrow(
      "Only a pending order's payment can be simulated as failed"
    );
  });

  it("cannot overwrite a successful capture after reading stale pending state", async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const productId = await createProduct(seller, { priceCents: 2000, stock: 5 });
    const orderId = await createOrder(buyer, seller, productId, { amountCents: 2000 });

    const blocker = await pool.connect();
    await blocker.query("begin");
    await blocker.query(`select id from orders where id = $1 for update`, [orderId]);
    try {
      // Queue success first. Failure queues behind it: the old implementation did a
      // stale unlocked read here, then unconditionally overwrote the paid state.
      const successPromise = simulateTestPaymentSuccess(orderId, buyer);
      await waitForBlockedPaymentTransitions(1);
      const failurePromise = simulateTestPaymentFailure(orderId, buyer);
      await waitForBlockedPaymentTransitions(2);
      await blocker.query("commit");

      const [success, failure] = await Promise.allSettled([successPromise, failurePromise]);
      expect(success.status).toBe("fulfilled");
      expect(failure.status).toBe("rejected");
    } finally {
      try {
        await blocker.query("rollback");
      } finally {
        blocker.release();
      }
    }

    expect((await getOrder(orderId)).status).toBe("paid");
    expect(Number((await getWallet(seller)).escrow_cents)).toBe(2000);
    expect(Number((await getProduct(productId)).stock)).toBe(4);
    expect(
      (
        await pool.query(`select id from domain_outbox where event_key = $1`, [
          `order.canceled:${orderId}`
        ])
      ).rows
    ).toHaveLength(0);
  });
});

describe("simulateTestPaymentWaitAccept", () => {
  it("leaves the order pending and unchanged", async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const productId = await createProduct(seller);
    const orderId = await createOrder(buyer, seller, productId);

    await simulateTestPaymentWaitAccept(orderId, buyer);

    const order = await getOrder(orderId);
    expect(order.status).toBe("pending");
  });
});
