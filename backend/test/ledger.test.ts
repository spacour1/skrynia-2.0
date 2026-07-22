import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.js";
import { lockEscrow, releaseEscrow, refundEscrow } from "../src/modules/orders/ledger.service.js";
import {
  closeDb,
  createConversation,
  createOrder,
  createProduct,
  createUser,
  getOrder,
  getPlatformRevenue,
  getProduct,
  getWallet,
  resetDb
} from "./fixtures.js";

beforeEach(resetDb);
afterAll(closeDb);

describe("lockEscrow", () => {
  it("captures payment, decrements stock, and holds funds in the seller's escrow", async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const productId = await createProduct(seller, { priceCents: 2000, stock: 5 });
    const orderId = await createOrder(buyer, seller, productId, { amountCents: 2000 });

    const updated = await lockEscrow(orderId, buyer, "mock");

    expect(updated.status).toBe("paid");
    expect(updated.payment_provider).toBe("mock");

    const product = await getProduct(productId);
    expect(Number(product.stock)).toBe(4);

    const sellerWallet = await getWallet(seller);
    expect(Number(sellerWallet.escrow_cents)).toBe(2000);

    const buyerWallet = await getWallet(buyer);
    expect(Number(buyerWallet.available_cents)).toBe(0);

    const txRows = await pool.query(`select type, direction, amount_cents from transactions where order_id = $1 order by type`, [
      orderId
    ]);
    expect(txRows.rows).toEqual([
      { type: "escrow_hold", direction: "credit", amount_cents: "2000" },
      { type: "payment_capture", direction: "neutral", amount_cents: "2000" }
    ]);

    const ledgerEntry = await pool.query(
      `select id from ledger_entries where idempotency_key = $1`,
      [`order:${orderId}:payment_capture`]
    );
    expect(ledgerEntry.rows).toHaveLength(1);
    const ledgerLines = await pool.query(
      `select debit_cents, credit_cents from ledger_lines where entry_id = $1`,
      [ledgerEntry.rows[0].id]
    );
    const debitTotal = ledgerLines.rows.reduce((sum, row) => sum + Number(row.debit_cents), 0);
    const creditTotal = ledgerLines.rows.reduce((sum, row) => sum + Number(row.credit_cents), 0);
    expect(debitTotal).toBe(2000);
    expect(creditTotal).toBe(2000);
  });

  it("delivers instantly and schedules auto-release when the product has an instant delivery template", async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const productId = await createProduct(seller, {
      priceCents: 1500,
      deliveryType: "instant",
      deliveryTemplate: "SECRET-KEY-123"
    });
    const orderId = await createOrder(buyer, seller, productId, { amountCents: 1500 });

    const updated = await lockEscrow(orderId, buyer, "mock");

    expect(updated.status).toBe("delivered");
    expect(updated.delivery_note).toBe("SECRET-KEY-123");
    expect(updated.auto_release_at).not.toBeNull();
  });

  it("commits the paid event, system message, and outbox intent with the capture", async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const productId = await createProduct(seller, { priceCents: 2000 });
    const orderId = await createOrder(buyer, seller, productId, { amountCents: 2000 });
    const conversationId = await createConversation(buyer, seller, productId, orderId);

    await lockEscrow(orderId, buyer, "mock");

    const event = await pool.query(
      `select actor_id as "actorId", type, metadata
       from order_events where order_id = $1 and type = 'paid'`,
      [orderId]
    );
    expect(event.rows).toHaveLength(1);
    expect(event.rows[0]).toMatchObject({ actorId: buyer, type: "paid" });
    expect(event.rows[0].metadata.provider).toBe("mock");

    const message = await pool.query(
      `select id, system_type as "systemType"
       from messages where conversation_id = $1 and system_type = 'payment_received'`,
      [conversationId]
    );
    expect(message.rows).toHaveLength(1);

    const outbox = await pool.query(
      `select event_key as "eventKey", event_type as "eventType", payload, status
       from domain_outbox where event_key = $1`,
      [`order.paid:${orderId}`]
    );
    expect(outbox.rows).toHaveLength(1);
    expect(outbox.rows[0]).toMatchObject({
      eventKey: `order.paid:${orderId}`,
      eventType: "order.paid",
      status: "pending"
    });
    expect(outbox.rows[0].payload.systemMessageIds).toEqual([message.rows[0].id]);
  });

  it("rolls back the capture when its durable paid intent cannot be stored", async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const productId = await createProduct(seller, { priceCents: 2000, stock: 5 });
    const orderId = await createOrder(buyer, seller, productId, { amountCents: 2000 });
    const conversationId = await createConversation(buyer, seller, productId, orderId);

    await pool.query(`drop trigger if exists test_fail_paid_outbox on domain_outbox`);
    await pool.query(`drop function if exists test_fail_paid_outbox_insert()`);
    await pool.query(`
      create function test_fail_paid_outbox_insert() returns trigger as $$
      begin
        if new.event_type = 'order.paid' then
          raise exception 'paid outbox unavailable';
        end if;
        return new;
      end;
      $$ language plpgsql
    `);
    await pool.query(`
      create trigger test_fail_paid_outbox
      before insert on domain_outbox
      for each row execute function test_fail_paid_outbox_insert()
    `);

    try {
      await expect(lockEscrow(orderId, buyer, "mock")).rejects.toThrow("paid outbox unavailable");
    } finally {
      await pool.query(`drop trigger if exists test_fail_paid_outbox on domain_outbox`);
      await pool.query(`drop function if exists test_fail_paid_outbox_insert()`);
    }

    expect((await getOrder(orderId)).status).toBe("pending");
    expect(Number((await getProduct(productId)).stock)).toBe(5);
    expect(Number((await getWallet(seller)).escrow_cents)).toBe(0);
    expect(
      (await pool.query(`select id from ledger_entries where order_id = $1`, [orderId])).rows
    ).toHaveLength(0);
    expect(
      (await pool.query(`select id from order_events where order_id = $1`, [orderId])).rows
    ).toHaveLength(0);
    expect(
      (await pool.query(`select id from messages where conversation_id = $1`, [conversationId])).rows
    ).toHaveLength(0);
    expect(
      (await pool.query(`select id from domain_outbox where aggregate_id = $1`, [orderId])).rows
    ).toHaveLength(0);
  });

  it("rejects paying an order that is not pending, preventing a double capture", async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const productId = await createProduct(seller);
    const orderId = await createOrder(buyer, seller, productId, { status: "paid" });

    await expect(lockEscrow(orderId, buyer, "mock")).rejects.toThrow("Only pending orders can be paid");
  });

  it("rejects a buyer paying someone else's order", async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const intruder = await createUser();
    const productId = await createProduct(seller);
    const orderId = await createOrder(buyer, seller, productId);

    await expect(lockEscrow(orderId, intruder, "mock")).rejects.toThrow("Only the buyer can pay this order");
  });

  it("rejects payment when stock ran out after the order was placed", async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const productId = await createProduct(seller, { stock: 0 });
    const orderId = await createOrder(buyer, seller, productId, { quantity: 1 });

    await expect(lockEscrow(orderId, buyer, "mock")).rejects.toThrow("Not enough stock");
  });
});

describe("releaseEscrow", () => {
  it("pays the seller net of the platform fee and books platform revenue", async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const productId = await createProduct(seller, { priceCents: 2000 });
    const orderId = await createOrder(buyer, seller, productId, { amountCents: 2000 });

    await lockEscrow(orderId, buyer, "mock");
    await pool.query(`update orders set status = 'delivered' where id = $1`, [orderId]);
    const revenueBefore = await getPlatformRevenue();

    const updated = await releaseEscrow(orderId);

    expect(updated.status).toBe("completed");
    const sellerWallet = await getWallet(seller);
    expect(Number(sellerWallet.escrow_cents)).toBe(0);
    expect(Number(sellerWallet.available_cents)).toBe(1800); // 2000 - 10% platform fee

    const revenueAfter = await getPlatformRevenue();
    expect(revenueAfter - revenueBefore).toBe(200);
  });

  it("rejects releasing an order that was never escrowed", async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const productId = await createProduct(seller);
    const orderId = await createOrder(buyer, seller, productId, { status: "delivered" });

    await expect(releaseEscrow(orderId)).rejects.toThrow("Escrow balance is insufficient");
  });

  it("rejects releasing a pending order", async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const productId = await createProduct(seller);
    const orderId = await createOrder(buyer, seller, productId);

    await expect(releaseEscrow(orderId)).rejects.toThrow("Only delivered or disputed orders can be released");
  });
});

describe("refundEscrow", () => {
  it("returns the full escrowed amount to the buyer and zeroes the seller's escrow", async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const productId = await createProduct(seller, { priceCents: 2000 });
    const orderId = await createOrder(buyer, seller, productId, { amountCents: 2000 });

    await lockEscrow(orderId, buyer, "mock");
    const updated = await refundEscrow(orderId);

    expect(updated.status).toBe("refunded");
    const sellerWallet = await getWallet(seller);
    expect(Number(sellerWallet.escrow_cents)).toBe(0);
    const buyerWallet = await getWallet(buyer);
    expect(Number(buyerWallet.available_cents)).toBe(2000);
  });
});

describe("full order lifecycle (smoke test)", () => {
  it("pays with the mock provider, delivers, and releases escrow to the seller", async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const productId = await createProduct(seller, { priceCents: 5000, stock: 1 });
    const orderId = await createOrder(buyer, seller, productId, { amountCents: 5000 });

    await lockEscrow(orderId, buyer, "mock");
    let order = await getOrder(orderId);
    expect(order.status).toBe("paid");

    await pool.query(`update orders set status = 'delivered' where id = $1`, [orderId]);
    await releaseEscrow(orderId);

    order = await getOrder(orderId);
    expect(order.status).toBe("completed");

    const sellerWallet = await getWallet(seller);
    expect(Number(sellerWallet.available_cents)).toBe(4500);
    expect(Number(sellerWallet.escrow_cents)).toBe(0);

    const product = await getProduct(productId);
    expect(Number(product.sales_count)).toBe(1);
  });
});
