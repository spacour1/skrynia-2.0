import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { env } from "../src/config/env.js";
import { getRedis } from "../src/common/redis.js";
import { pool } from "../src/db/pool.js";
import {
  platformFeeCents,
  POSTGRES_BIGINT_MAX,
  POSTGRES_BIGINT_MIN
} from "../src/domain/money.js";
import { issueSession } from "../src/modules/auth/session.service.js";
import {
  lockEscrow,
  refundEscrow,
  releaseEscrow
} from "../src/modules/orders/ledger.service.js";
import { getPaymentProvider } from "../src/modules/payments/payment.providers.js";
import {
  completeWalletTopup,
  createWalletTopup,
  postManualAdjustment
} from "../src/modules/users/wallet.service.js";
import {
  closeDb,
  createProduct,
  createOrder,
  createUser,
  getOrder,
  getWallet,
  resetDb
} from "./fixtures.js";

const app = createApp();
const originalMoneyEnv = {
  platformFeeBps: env.PLATFORM_FEE_BPS,
  monobankToken: env.MONOBANK_TOKEN,
  wayforpayMerchantAccount: env.WAYFORPAY_MERCHANT_ACCOUNT,
  wayforpayMerchantSecretKey: env.WAYFORPAY_MERCHANT_SECRET_KEY
};

beforeEach(resetDb);
afterEach(() => {
  env.PLATFORM_FEE_BPS = originalMoneyEnv.platformFeeBps;
  env.MONOBANK_TOKEN = originalMoneyEnv.monobankToken;
  env.WAYFORPAY_MERCHANT_ACCOUNT = originalMoneyEnv.wayforpayMerchantAccount;
  env.WAYFORPAY_MERCHANT_SECRET_KEY = originalMoneyEnv.wayforpayMerchantSecretKey;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
afterAll(async () => {
  await getRedis()?.quit();
  await closeDb();
});

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

describe("MoneyCents order and ledger integration", () => {
  it("keeps max-quantity amounts above Number.MAX_SAFE_INTEGER exact end to end", async () => {
    const unitPriceCents = "9007199254740993";
    const quantity = 100;
    const amountCents = (BigInt(unitPriceCents) * BigInt(quantity)).toString();
    const feeCents = platformFeeCents(amountCents, env.PLATFORM_FEE_BPS);
    const netCents = (BigInt(amountCents) - BigInt(feeCents)).toString();

    const seller = await createUser();
    const buyer = await createUser();
    await pool.query(`update users set email_verified_at = now() where id = $1`, [buyer]);
    const productId = await createProduct(seller, {
      priceCents: unitPriceCents,
      stock: quantity
    });
    const buyerAgent = await agentFor(buyer);

    const created = await buyerAgent
      .post("/orders")
      .set("Idempotency-Key", randomUUID())
      .send({ productId, quantity });

    expect(created.status).toBe(201);
    expect(created.body.order).toMatchObject({
      amountCents,
      feeCents: "0",
      quantity,
      status: "pending"
    });
    expect(typeof created.body.order.amountCents).toBe("string");
    const orderId = created.body.order.id as string;
    expect((await getOrder(orderId)).amount_cents).toBe(amountCents);

    const productResponse = await request(app).get(`/marketplace/products/${productId}`);
    expect(productResponse.status).toBe(200);
    expect(productResponse.body.product.priceCents).toBe(unitPriceCents);
    expect(typeof productResponse.body.product.priceCents).toBe("string");

    const captureResponse = await buyerAgent
      .post(`/payments/orders/${orderId}/pay`)
      .send({ provider: "mock" });
    expect(captureResponse.status).toBe(200);
    expect(captureResponse.body.order.status).toBe("paid");
    expect(captureResponse.body.order.amountCents).toBe(amountCents);
    expect(captureResponse.body.order.feeCents).toBe(feeCents);
    expect(typeof captureResponse.body.order.amountCents).toBe("string");
    const captured = await getOrder(orderId);
    expect(captured.amount_cents).toBe(amountCents);
    expect(captured.fee_cents).toBe(feeCents);
    expect((await getWallet(seller)).escrow_cents).toBe(amountCents);

    const captureLines = await pool.query(
      `select l.debit_cents, l.credit_cents
       from ledger_lines l
       join ledger_entries e on e.id = l.entry_id
       where e.order_id = $1 and e.entry_type = 'payment_capture'
       order by l.debit_cents desc`,
      [orderId]
    );
    expect(captureLines.rows).toEqual([
      { debit_cents: amountCents, credit_cents: "0" },
      { debit_cents: "0", credit_cents: amountCents }
    ]);

    await pool.query(`update orders set status = 'delivered' where id = $1`, [orderId]);
    const completed = await releaseEscrow(orderId);
    expect(completed.status).toBe("completed");
    expect(completed.amount_cents).toBe(amountCents);
    expect(completed.fee_cents).toBe(feeCents);

    const sellerWallet = await getWallet(seller);
    expect(sellerWallet.available_cents).toBe(netCents);
    expect(sellerWallet.escrow_cents).toBe("0");
    const platform = await pool.query<{ revenue_cents: string }>(
      `select revenue_cents from platform_wallets where currency = 'UAH'`
    );
    expect(platform.rows[0].revenue_cents).toBe(feeCents);

    const releaseLines = await pool.query(
      `select a.code, l.debit_cents, l.credit_cents
       from ledger_lines l
       join ledger_entries e on e.id = l.entry_id
       join ledger_accounts a on a.id = l.account_id
       where e.order_id = $1 and e.entry_type = 'escrow_release'
       order by a.code`,
      [orderId]
    );
    expect(releaseLines.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ debit_cents: amountCents, credit_cents: "0" }),
        expect.objectContaining({ debit_cents: "0", credit_cents: netCents }),
        expect.objectContaining({ debit_cents: "0", credit_cents: feeCents })
      ])
    );

    const orderResponse = await buyerAgent.get(`/orders/${orderId}`);
    expect(orderResponse.status).toBe(200);
    expect(orderResponse.body.order.amountCents).toBe(amountCents);
    expect(orderResponse.body.order.feeCents).toBe(feeCents);
    expect(typeof orderResponse.body.order.amountCents).toBe("string");

    const sellerAgent = await agentFor(seller);
    const walletResponse = await sellerAgent.get("/users/me/wallet");
    expect(walletResponse.status).toBe(200);
    expect(walletResponse.body.wallet.availableCents).toBe(netCents);
    expect(walletResponse.body.wallet.escrowCents).toBe("0");
    expect(
      walletResponse.body.transactions.every(
        (transaction: { amountCents: unknown }) =>
          typeof transaction.amountCents === "string"
      )
    ).toBe(true);
  });

  it("rejects max-quantity multiplication that exceeds PostgreSQL bigint", async () => {
    const seller = await createUser();
    const buyer = await createUser();
    await pool.query(`update users set email_verified_at = now() where id = $1`, [buyer]);
    const productId = await createProduct(seller, {
      priceCents: "9223372036854775807",
      stock: 100
    });
    const buyerAgent = await agentFor(buyer);

    const response = await buyerAgent
      .post("/orders")
      .set("Idempotency-Key", randomUUID())
      .send({ productId, quantity: 100 });

    expect(response.status).toBe(400);
    expect(response.body.error.message).toBe("Order amount is too large");
    const orders = await pool.query<{ count: number }>(
      `select count(*)::int as count from orders where buyer_id = $1`,
      [buyer]
    );
    expect(orders.rows[0].count).toBe(0);
  });

  it("detects a one-cent escrow shortfall above Number.MAX_SAFE_INTEGER", async () => {
    const amountCents = "9007199254740993";
    const escrowCents = "9007199254740992";
    const seller = await createUser();
    const buyer = await createUser();
    const productId = await createProduct(seller, { priceCents: amountCents });
    const orderId = await createOrder(buyer, seller, productId, {
      amountCents,
      status: "delivered"
    });
    await pool.query(
      `insert into wallets(user_id, currency, escrow_cents)
       values ($1, 'UAH', $2)`,
      [seller, escrowCents]
    );

    await expect(releaseEscrow(orderId)).rejects.toThrow(
      "Escrow balance is insufficient"
    );

    expect((await getOrder(orderId)).status).toBe("delivered");
    expect((await getWallet(seller)).escrow_cents).toBe(escrowCents);
    const ledger = await pool.query(
      `select id from ledger_entries where order_id = $1`,
      [orderId]
    );
    expect(ledger.rows).toHaveLength(0);
  });
});

describe("MoneyCents persistence boundaries", () => {
  it("rejects seller escrow overflow before capture or any persisted order mutation", async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const productId = await createProduct(seller, { priceCents: "1", stock: 2 });
    const orderId = await createOrder(buyer, seller, productId, { amountCents: "1" });
    await pool.query(
      `insert into wallets(user_id, currency, escrow_cents)
       values ($1, 'UAH', $2)`,
      [seller, POSTGRES_BIGINT_MAX.toString()]
    );
    const captureSpy = vi.spyOn(getPaymentProvider("mock"), "capture");

    await expect(lockEscrow(orderId, buyer, "mock")).rejects.toThrow(
      "Seller escrow balance exceeds the supported money range"
    );

    expect(captureSpy).not.toHaveBeenCalled();
    expect((await getOrder(orderId)).status).toBe("pending");
    expect((await getWallet(seller)).escrow_cents).toBe(POSTGRES_BIGINT_MAX.toString());
    const product = await pool.query<{ stock: number }>(`select stock from products where id = $1`, [productId]);
    expect(Number(product.rows[0].stock)).toBe(2);
    expect((await pool.query(`select id from transactions where order_id = $1`, [orderId])).rows).toHaveLength(0);
  });

  it("uses a persisted zero fee after configuration changes and omits a zero ledger line", async () => {
    env.PLATFORM_FEE_BPS = 0;
    const seller = await createUser();
    const buyer = await createUser();
    const productId = await createProduct(seller, { priceCents: "1000" });
    const orderId = await createOrder(buyer, seller, productId, { amountCents: "1000" });

    const paid = await lockEscrow(orderId, buyer, "mock");
    expect(paid.fee_cents).toBe("0");
    env.PLATFORM_FEE_BPS = 2500;
    await pool.query(`update orders set status = 'delivered' where id = $1`, [orderId]);

    await releaseEscrow(orderId);

    expect((await getWallet(seller)).available_cents).toBe("1000");
    const platform = await pool.query<{ revenue_cents: string }>(
      `select revenue_cents from platform_wallets where currency = 'UAH'`
    );
    expect(platform.rows[0].revenue_cents).toBe("0");
    const releaseLines = await pool.query(
      `select l.debit_cents, l.credit_cents
       from ledger_lines l
       join ledger_entries e on e.id = l.entry_id
       where e.order_id = $1 and e.entry_type = 'escrow_release'`,
      [orderId]
    );
    expect(releaseLines.rows).toHaveLength(2);
    expect(releaseLines.rows).toEqual(
      expect.arrayContaining([
        { debit_cents: "1000", credit_cents: "0" },
        { debit_cents: "0", credit_cents: "1000" }
      ])
    );
  });

  it("rejects release when the seller available balance would overflow", async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const productId = await createProduct(seller, { priceCents: "1" });
    const orderId = await createOrder(buyer, seller, productId, {
      amountCents: "1",
      status: "delivered"
    });
    await pool.query(
      `insert into wallets(user_id, currency, available_cents, escrow_cents)
       values ($1, 'UAH', $2, 1)`,
      [seller, POSTGRES_BIGINT_MAX.toString()]
    );

    await expect(releaseEscrow(orderId)).rejects.toThrow(
      "Seller available balance exceeds the supported money range"
    );

    expect(await getWallet(seller)).toEqual({
      available_cents: POSTGRES_BIGINT_MAX.toString(),
      escrow_cents: "1"
    });
    expect((await getOrder(orderId)).status).toBe("delivered");
  });

  it("rejects release before wallet mutation when platform revenue would overflow", async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const productId = await createProduct(seller, { priceCents: "100" });
    const orderId = await createOrder(buyer, seller, productId, {
      amountCents: "100",
      status: "delivered"
    });
    await pool.query(`update orders set fee_cents = 1 where id = $1`, [orderId]);
    await pool.query(
      `insert into wallets(user_id, currency, escrow_cents) values ($1, 'UAH', 100)`,
      [seller]
    );
    await pool.query(
      `update platform_wallets set revenue_cents = $1 where currency = 'UAH'`,
      [POSTGRES_BIGINT_MAX.toString()]
    );

    await expect(releaseEscrow(orderId)).rejects.toThrow(
      "Platform revenue balance exceeds the supported money range"
    );

    expect(await getWallet(seller)).toEqual({ available_cents: "0", escrow_cents: "100" });
    expect((await getOrder(orderId)).status).toBe("delivered");
  });

  it("rejects refund when the buyer available balance would overflow", async () => {
    const seller = await createUser();
    const buyer = await createUser();
    const productId = await createProduct(seller, { priceCents: "1" });
    const orderId = await createOrder(buyer, seller, productId, {
      amountCents: "1",
      status: "paid"
    });
    await pool.query(
      `insert into wallets(user_id, currency, escrow_cents) values ($1, 'UAH', 1)`,
      [seller]
    );
    await pool.query(
      `insert into wallets(user_id, currency, available_cents) values ($1, 'UAH', $2)`,
      [buyer, POSTGRES_BIGINT_MAX.toString()]
    );

    await expect(refundEscrow(orderId)).rejects.toThrow(
      "Buyer available balance exceeds the supported money range"
    );

    expect((await getWallet(seller)).escrow_cents).toBe("1");
    expect((await getWallet(buyer)).available_cents).toBe(POSTGRES_BIGINT_MAX.toString());
    expect((await getOrder(orderId)).status).toBe("paid");
  });

  it("keeps a top-up pending when crediting it would overflow", async () => {
    const userId = await createUser();
    await pool.query(
      `insert into wallets(user_id, currency, available_cents) values ($1, 'UAH', $2)`,
      [userId, POSTGRES_BIGINT_MAX.toString()]
    );
    const topup = await createWalletTopup(userId, "1", "UAH");

    await expect(completeWalletTopup(topup.id, "liqpay", "payment-1")).rejects.toThrow(
      "Wallet balance exceeds the supported money range"
    );

    const persisted = await pool.query(`select status from wallet_topups where id = $1`, [topup.id]);
    expect(persisted.rows[0].status).toBe("pending");
    expect((await getWallet(userId)).available_cents).toBe(POSTGRES_BIGINT_MAX.toString());
    expect((await pool.query(`select id from transactions where user_id = $1`, [userId])).rows).toHaveLength(0);
  });

  it("rejects manual adjustment overflow and PostgreSQL bigint minimum as controlled input errors", async () => {
    const adminId = await createUser("admin");
    const userId = await createUser();
    await pool.query(
      `insert into wallets(user_id, currency, available_cents) values ($1, 'UAH', $2)`,
      [userId, POSTGRES_BIGINT_MAX.toString()]
    );

    await expect(postManualAdjustment({
      userId,
      amountCents: "1",
      currency: "UAH",
      reason: "Boundary correction",
      adminId
    })).rejects.toThrow("Wallet balance exceeds the supported money range");

    await expect(postManualAdjustment({
      userId,
      amountCents: POSTGRES_BIGINT_MIN.toString(),
      currency: "UAH",
      reason: "Invalid boundary correction",
      adminId
    })).rejects.toThrow("Adjustment amount magnitude exceeds the supported money range");

    expect((await getWallet(userId)).available_cents).toBe(POSTGRES_BIGINT_MAX.toString());
    expect((await pool.query(`select id from transactions where user_id = $1`, [userId])).rows).toHaveLength(0);

    const adminAgent = await agentFor(adminId, "admin");
    const response = await adminAgent.post("/admin/ledger/adjustments").send({
      userId,
      amountCents: POSTGRES_BIGINT_MIN.toString(),
      currency: "UAH",
      reason: "Invalid boundary correction"
    });
    expect(response.status).toBe(400);
  });

  it("rejects unsafe Monobank and WayForPay top-ups before INSERT and fetch", async () => {
    const userId = await createUser();
    await pool.query(`update users set email_verified_at = now() where id = $1`, [userId]);
    const userAgent = await agentFor(userId);
    env.MONOBANK_TOKEN = "test-token";
    env.WAYFORPAY_MERCHANT_ACCOUNT = "test-merchant";
    env.WAYFORPAY_MERCHANT_SECRET_KEY = "test-secret";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const monobank = await userAgent
      .post("/payments/wallet/monobank/checkout")
      .send({ amount: "90071992547409.93" });
    const wayforpay = await userAgent
      .post("/payments/wallet/wayforpay/checkout")
      .send({ amount: "90071992547409.93" });

    expect(monobank.status).toBe(400);
    expect(wayforpay.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    const topups = await pool.query<{ count: number }>(
      `select count(*)::int as count from wallet_topups where user_id = $1`,
      [userId]
    );
    expect(topups.rows[0].count).toBe(0);
  });
});
