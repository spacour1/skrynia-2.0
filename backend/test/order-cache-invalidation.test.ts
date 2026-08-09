import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { getRedis } from "../src/common/redis.js";
import { pool } from "../src/db/pool.js";
import { issueSession } from "../src/modules/auth/session.service.js";
import {
  lockEscrow,
  refundEscrow,
  releaseEscrow
} from "../src/modules/orders/ledger.service.js";
import { runAutoReleaseSweep } from "../src/modules/orders/auto-release.job.js";
import { simulateTestPaymentFailure } from "../src/modules/payments/test-payments.service.js";
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

type ParticipantCacheKeys = ReturnType<typeof participantCacheKeys>;

const app = createApp();
const testCacheKeys = new Set<string>();

beforeEach(resetDb);

afterEach(async () => {
  const redis = getRedis();
  if (redis && testCacheKeys.size > 0) {
    await redis.del(...testCacheKeys);
  }
  testCacheKeys.clear();
});

afterAll(async () => {
  await getRedis()?.quit();
  await closeDb();
});

function participantCacheKeys(orderId: string, buyerId: string, sellerId: string) {
  return {
    orderReads: [
      `order:${orderId}:${buyerId}:user`,
      `order:${orderId}:${sellerId}:user`,
      `orders:${buyerId}:buyer:any:100:first`,
      `orders:${sellerId}:seller:any:100:first`
    ],
    buyerWallet: `user:${buyerId}:wallet`,
    sellerWallet: `user:${sellerId}:wallet`
  };
}

function allKeys(keys: ParticipantCacheKeys) {
  return [...keys.orderReads, keys.buyerWallet, keys.sellerWallet];
}

async function warmParticipantCaches(keys: ParticipantCacheKeys) {
  const redis = getRedis();
  if (!redis) throw new Error("Order cache integration tests require Redis");

  for (const key of allKeys(keys)) {
    testCacheKeys.add(key);
    await redis.set(key, JSON.stringify({ stale: key }));
  }
}

async function expectCacheState(keys: string[], exists: boolean) {
  const redis = getRedis();
  if (!redis) throw new Error("Order cache integration tests require Redis");

  for (const key of keys) {
    expect(await redis.exists(key), `unexpected Redis state for ${key}`).toBe(
      exists ? 1 : 0
    );
  }
}

async function createPendingOrder(amountCents = 2_000) {
  const sellerId = await createUser();
  const buyerId = await createUser();
  const productId = await createProduct(sellerId, {
    priceCents: amountCents,
    stock: 5
  });
  const orderId = await createOrder(buyerId, sellerId, productId, {
    amountCents
  });
  return { sellerId, buyerId, productId, orderId };
}

async function agentFor(userId: string, role: "user" | "admin" = "user") {
  const session = await issueSession(userId, role);
  const cookie = [
    `access_token=${session.accessToken}`,
    `csrf_token=${session.csrfToken}`
  ];
  return {
    get: (path: string) => request(app).get(path).set("Cookie", cookie),
    post: (path: string) =>
      request(app)
        .post(path)
        .set("Cookie", cookie)
        .set("X-CSRF-Token", session.csrfToken)
  };
}

async function verifyUsers(...userIds: string[]) {
  await pool.query(
    `update users set email_verified_at = now() where id = any($1::uuid[])`,
    [userIds]
  );
}

async function expectBalancedLedger(
  orderId: string,
  entryType: "escrow_release" | "refund"
) {
  const result = await pool.query<{
    entry_type: string;
    debit_cents: string;
    credit_cents: string;
  }>(
    `select e.entry_type,
            sum(l.debit_cents)::text as debit_cents,
            sum(l.credit_cents)::text as credit_cents
     from ledger_entries e
     join ledger_lines l on l.entry_id = e.id
     where e.order_id = $1 and e.entry_type = $2
     group by e.id, e.entry_type`,
    [orderId, entryType]
  );
  expect(result.rows).toHaveLength(1);
  expect(BigInt(result.rows[0].debit_cents)).toBeGreaterThan(0n);
  expect(result.rows[0].debit_cents).toBe(result.rows[0].credit_cents);
}

async function setupEscrowedApiOrder() {
  const order = await createPendingOrder();
  await verifyUsers(order.buyerId, order.sellerId);
  await lockEscrow(order.orderId, order.buyerId, "mock");
  return {
    ...order,
    buyer: await agentFor(order.buyerId),
    seller: await agentFor(order.sellerId)
  };
}

async function warmParticipantApiReads(input: {
  orderId: string;
  buyerId: string;
  sellerId: string;
  buyer: Awaited<ReturnType<typeof agentFor>>;
  seller: Awaited<ReturnType<typeof agentFor>>;
}) {
  const responses = await Promise.all([
    input.buyer.get(`/orders/${input.orderId}`),
    input.seller.get(`/orders/${input.orderId}`),
    input.buyer.get("/orders?role=buyer"),
    input.seller.get("/orders?role=seller"),
    input.buyer.get("/users/me/wallet"),
    input.seller.get("/users/me/wallet")
  ]);
  for (const response of responses) expect(response.status).toBe(200);

  const keys = participantCacheKeys(
    input.orderId,
    input.buyerId,
    input.sellerId
  );
  await expectCacheState(allKeys(keys), true);
  return {
    keys,
    buyerWallet: responses[4].body,
    sellerWallet: responses[5].body
  };
}

async function openDisputeThroughApi(
  input: Awaited<ReturnType<typeof setupEscrowedApiOrder>>
) {
  const response = await input.buyer
    .post(`/disputes/orders/${input.orderId}/dispute`)
    .send({ reason: "The delivered item does not match the listing" });
  expect(response.status).toBe(201);
  return response.body.dispute.id as string;
}

describe("order participant cache invalidation", () => {
  it("evicts both wallet histories and every participant order read after payment capture", async () => {
    const { sellerId, buyerId, orderId } = await createPendingOrder();
    const keys = participantCacheKeys(orderId, buyerId, sellerId);
    await warmParticipantCaches(keys);

    const updated = await lockEscrow(orderId, buyerId, "mock");

    expect(updated.status).toBe("paid");
    await expectCacheState(allKeys(keys), false);
    expect((await getOrder(orderId)).status).toBe("paid");
    expect((await getWallet(sellerId)).escrow_cents).toBe("2000");
    const transactionTypes = await pool.query<{ type: string }>(
      `select type from transactions where order_id = $1 order by type`,
      [orderId]
    );
    expect(transactionTypes.rows.map((row) => row.type)).toEqual([
      "escrow_hold",
      "payment_capture"
    ]);
  });

  it("evicts only the changed seller wallet after escrow release", async () => {
    const { sellerId, buyerId, orderId } = await createPendingOrder();
    await lockEscrow(orderId, buyerId, "mock");
    await pool.query(`update orders set status = 'delivered' where id = $1`, [orderId]);
    const keys = participantCacheKeys(orderId, buyerId, sellerId);
    await warmParticipantCaches(keys);

    const updated = await releaseEscrow(orderId);

    expect(updated.status).toBe("completed");
    await expectCacheState(keys.orderReads, false);
    await expectCacheState([keys.sellerWallet], false);
    await expectCacheState([keys.buyerWallet], true);
    expect((await getWallet(sellerId)).available_cents).toBe("1800");
    expect((await getWallet(sellerId)).escrow_cents).toBe("0");
    await expectBalancedLedger(orderId, "escrow_release");
  });

  it("uses the same post-commit cache boundary for automatic release", async () => {
    const order = await setupEscrowedApiOrder();
    await pool.query(
      `update orders
       set status = 'delivered', auto_release_at = now() - interval '1 minute'
       where id = $1`,
      [order.orderId]
    );
    const warmed = await warmParticipantApiReads(order);

    await runAutoReleaseSweep();

    await expectCacheState(warmed.keys.orderReads, false);
    await expectCacheState([warmed.keys.sellerWallet], false);
    await expectCacheState([warmed.keys.buyerWallet], true);
    expect((await order.buyer.get(`/orders/${order.orderId}`)).body.order.status).toBe(
      "completed"
    );
    expect((await order.buyer.get("/users/me/wallet")).body).toEqual(
      warmed.buyerWallet
    );
    const sellerWallet = await order.seller.get("/users/me/wallet");
    expect(sellerWallet.body.wallet.availableCents).toBe("1800");
    expect(sellerWallet.body.wallet.escrowCents).toBe("0");
    await expectBalancedLedger(order.orderId, "escrow_release");
  });

  it("evicts both wallet histories and every participant order read after a refund", async () => {
    const { sellerId, buyerId, orderId } = await createPendingOrder();
    await lockEscrow(orderId, buyerId, "mock");
    const keys = participantCacheKeys(orderId, buyerId, sellerId);
    await warmParticipantCaches(keys);

    const updated = await refundEscrow(orderId);

    expect(updated.status).toBe("refunded");
    await expectCacheState(allKeys(keys), false);
    expect((await getWallet(buyerId)).available_cents).toBe("2000");
    expect((await getWallet(sellerId)).escrow_cents).toBe("0");
    await expectBalancedLedger(orderId, "refund");
  });

  it("keeps both wallet reads warm when a failed test payment only cancels the order", async () => {
    const { sellerId, buyerId, orderId } = await createPendingOrder();
    const keys = participantCacheKeys(orderId, buyerId, sellerId);
    await warmParticipantCaches(keys);

    const updated = await simulateTestPaymentFailure(orderId, buyerId);

    expect(updated.status).toBe("canceled");
    await expectCacheState(keys.orderReads, false);
    await expectCacheState([keys.buyerWallet, keys.sellerWallet], true);
    expect((await getOrder(orderId)).status).toBe("canceled");
    const transactions = await pool.query(
      `select id from transactions where order_id = $1`,
      [orderId]
    );
    expect(transactions.rows).toHaveLength(0);
  });

  it("does not evict warm reads when a transaction fails during commit", async () => {
    const { sellerId, buyerId, productId, orderId } = await createPendingOrder();
    const keys = participantCacheKeys(orderId, buyerId, sellerId);
    await warmParticipantCaches(keys);

    await pool.query(`drop trigger if exists test_fail_payment_commit on orders`);
    await pool.query(`drop function if exists test_fail_payment_commit()`);
    await pool.query(`
      create function test_fail_payment_commit() returns trigger as $$
      begin
        if new.status = 'paid' then
          raise exception 'commit-time payment failure';
        end if;
        return new;
      end;
      $$ language plpgsql
    `);
    await pool.query(`
      create constraint trigger test_fail_payment_commit
      after update on orders
      deferrable initially deferred
      for each row execute function test_fail_payment_commit()
    `);

    try {
      await expect(lockEscrow(orderId, buyerId, "mock")).rejects.toThrow(
        "commit-time payment failure"
      );
    } finally {
      await pool.query(`drop trigger if exists test_fail_payment_commit on orders`);
      await pool.query(`drop function if exists test_fail_payment_commit()`);
    }

    await expectCacheState(allKeys(keys), true);
    expect((await getOrder(orderId)).status).toBe("pending");
    expect(Number((await getProduct(productId)).stock)).toBe(5);
    expect((await getWallet(sellerId)).escrow_cents).toBe("0");
    const transactions = await pool.query(
      `select id from transactions where order_id = $1`,
      [orderId]
    );
    expect(transactions.rows).toHaveLength(0);
  });

  it("does not evict warm reads when a refund fails during commit", async () => {
    const { sellerId, buyerId, orderId } = await createPendingOrder();
    await lockEscrow(orderId, buyerId, "mock");
    const keys = participantCacheKeys(orderId, buyerId, sellerId);
    await warmParticipantCaches(keys);

    await pool.query(`drop trigger if exists test_fail_refund_commit on orders`);
    await pool.query(`drop function if exists test_fail_refund_commit()`);
    await pool.query(`
      create function test_fail_refund_commit() returns trigger as $$
      begin
        if new.status = 'refunded' then
          raise exception 'commit-time refund failure';
        end if;
        return new;
      end;
      $$ language plpgsql
    `);
    await pool.query(`
      create constraint trigger test_fail_refund_commit
      after update on orders
      deferrable initially deferred
      for each row execute function test_fail_refund_commit()
    `);

    try {
      await expect(refundEscrow(orderId)).rejects.toThrow(
        "commit-time refund failure"
      );
    } finally {
      await pool.query(`drop trigger if exists test_fail_refund_commit on orders`);
      await pool.query(`drop function if exists test_fail_refund_commit()`);
    }

    await expectCacheState(allKeys(keys), true);
    expect((await getOrder(orderId)).status).toBe("paid");
    expect((await getWallet(buyerId)).available_cents).toBe("0");
    expect((await getWallet(sellerId)).escrow_cents).toBe("2000");
    const refundTransactions = await pool.query(
      `select id from transactions where order_id = $1 and type = 'refund'`,
      [orderId]
    );
    expect(refundTransactions.rows).toHaveLength(0);
    const refundLedgerEntries = await pool.query(
      `select id from ledger_entries where order_id = $1 and entry_type = 'refund'`,
      [orderId]
    );
    expect(refundLedgerEntries.rows).toHaveLength(0);
  });

  it("refreshes real empty buyer and seller lists after order creation without touching wallets", async () => {
    const sellerId = await createUser();
    const buyerId = await createUser();
    await verifyUsers(buyerId, sellerId);
    const productId = await createProduct(sellerId);
    const buyer = await agentFor(buyerId);
    const seller = await agentFor(sellerId);
    const buyerListKey = `orders:${buyerId}:buyer:any:100:first`;
    const sellerListKey = `orders:${sellerId}:seller:any:100:first`;
    const buyerWalletKey = `user:${buyerId}:wallet`;
    const sellerWalletKey = `user:${sellerId}:wallet`;

    const [buyerListBefore, sellerListBefore, buyerWalletBefore, sellerWalletBefore] =
      await Promise.all([
        buyer.get("/orders?role=buyer"),
        seller.get("/orders?role=seller"),
        buyer.get("/users/me/wallet"),
        seller.get("/users/me/wallet")
      ]);
    expect(buyerListBefore.body.orders).toEqual([]);
    expect(sellerListBefore.body.orders).toEqual([]);
    await expectCacheState(
      [buyerListKey, sellerListKey, buyerWalletKey, sellerWalletKey],
      true
    );

    const created = await buyer
      .post("/orders")
      .set("Idempotency-Key", randomUUID())
      .send({ productId, quantity: 1 });

    expect(created.status).toBe(201);
    const orderId = created.body.order.id as string;
    await expectCacheState([buyerListKey, sellerListKey], false);
    await expectCacheState([buyerWalletKey, sellerWalletKey], true);
    const [buyerListAfter, sellerListAfter] = await Promise.all([
      buyer.get("/orders?role=buyer"),
      seller.get("/orders?role=seller")
    ]);
    expect(buyerListAfter.body.orders[0]).toMatchObject({ id: orderId, status: "pending" });
    expect(sellerListAfter.body.orders[0]).toMatchObject({ id: orderId, status: "pending" });
    expect((await buyer.get("/users/me/wallet")).body).toEqual(buyerWalletBefore.body);
    expect((await seller.get("/users/me/wallet")).body).toEqual(sellerWalletBefore.body);
  });

  it("refreshes real order reads after a dispute opens and keeps wallet reads warm", async () => {
    const order = await setupEscrowedApiOrder();
    const warmed = await warmParticipantApiReads(order);

    await openDisputeThroughApi(order);

    await expectCacheState(warmed.keys.orderReads, false);
    await expectCacheState(
      [warmed.keys.buyerWallet, warmed.keys.sellerWallet],
      true
    );
    const [buyerDetail, sellerDetail, buyerList, sellerList] = await Promise.all([
      order.buyer.get(`/orders/${order.orderId}`),
      order.seller.get(`/orders/${order.orderId}`),
      order.buyer.get("/orders?role=buyer"),
      order.seller.get("/orders?role=seller")
    ]);
    expect(buyerDetail.body.order.status).toBe("disputed");
    expect(sellerDetail.body.order.status).toBe("disputed");
    expect(buyerList.body.orders[0].status).toBe("disputed");
    expect(sellerList.body.orders[0].status).toBe("disputed");
    expect((await order.buyer.get("/users/me/wallet")).body).toEqual(
      warmed.buyerWallet
    );
    expect((await order.seller.get("/users/me/wallet")).body).toEqual(
      warmed.sellerWallet
    );
  });

  it.each([
    {
      decision: "release" as const,
      expectedStatus: "completed",
      ledgerType: "escrow_release" as const
    },
    {
      decision: "refund" as const,
      expectedStatus: "refunded",
      ledgerType: "refund" as const
    }
  ])(
    "refreshes real order and affected wallet reads after dispute $decision",
    async ({ decision, expectedStatus, ledgerType }) => {
      const order = await setupEscrowedApiOrder();
      const disputeId = await openDisputeThroughApi(order);
      const warmed = await warmParticipantApiReads(order);
      const adminId = await createUser("admin");
      const admin = await agentFor(adminId, "admin");

      const resolved = await admin
        .post(`/disputes/${disputeId}/resolve`)
        .send({ decision, adminNote: `Approved ${decision}` });

      expect(resolved.status).toBe(200);
      expect(resolved.body.order.status).toBe(expectedStatus);
      await expectCacheState(warmed.keys.orderReads, false);
      await expectCacheState([warmed.keys.sellerWallet], false);
      await expectCacheState(
        [warmed.keys.buyerWallet],
        decision === "release"
      );

      const [buyerDetail, sellerDetail, buyerList, sellerList] = await Promise.all([
        order.buyer.get(`/orders/${order.orderId}`),
        order.seller.get(`/orders/${order.orderId}`),
        order.buyer.get("/orders?role=buyer"),
        order.seller.get("/orders?role=seller")
      ]);
      expect(buyerDetail.body.order.status).toBe(expectedStatus);
      expect(sellerDetail.body.order.status).toBe(expectedStatus);
      expect(buyerList.body.orders[0].status).toBe(expectedStatus);
      expect(sellerList.body.orders[0].status).toBe(expectedStatus);

      const [buyerWalletAfter, sellerWalletAfter] = await Promise.all([
        order.buyer.get("/users/me/wallet"),
        order.seller.get("/users/me/wallet")
      ]);
      if (decision === "release") {
        expect(buyerWalletAfter.body).toEqual(warmed.buyerWallet);
        expect(sellerWalletAfter.body.wallet.availableCents).toBe("1800");
      } else {
        expect(buyerWalletAfter.body.wallet.availableCents).toBe("2000");
      }
      expect(sellerWalletAfter.body.wallet.escrowCents).toBe("0");
      await expectBalancedLedger(order.orderId, ledgerType);
    }
  );
});
