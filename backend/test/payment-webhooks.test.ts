import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const providerMocks = vi.hoisted(() => ({
  decodeLiqpayCallback: vi.fn(),
  verifyLiqpaySignature: vi.fn(),
  getMonobankInvoiceStatus: vi.fn(),
  getWayforpayStatus: vi.fn()
}));

vi.mock("../src/modules/payments/liqpay.service.js", () => ({
  buildLiqpayCheckout: vi.fn(),
  decodeLiqpayCallback: providerMocks.decodeLiqpayCallback,
  isLiqpaySuccessStatus: (status: string) => status === "success",
  verifyLiqpaySignature: providerMocks.verifyLiqpaySignature
}));

vi.mock("../src/modules/payments/monobank.service.js", () => ({
  createMonobankInvoice: vi.fn(),
  getMonobankInvoiceStatus: providerMocks.getMonobankInvoiceStatus,
  isMonobankSuccessStatus: (status: string) => status === "success"
}));

vi.mock("../src/modules/payments/wayforpay.service.js", () => ({
  buildWayforpayAck: (orderReference: string) => ({
    orderReference,
    status: "accept",
    time: 1,
    signature: "test-signature"
  }),
  createWayforpayInvoice: vi.fn(),
  getWayforpayStatus: providerMocks.getWayforpayStatus,
  isWayforpaySuccessStatus: (status?: string) => status === "Approved"
}));

import { createApp } from "../src/app.js";
import { getRedis } from "../src/common/redis.js";
import { pool } from "../src/db/pool.js";
import {
  closeDb,
  createOrder,
  createProduct,
  createUser,
  getOrder,
  getWallet,
  resetDb
} from "./fixtures.js";

const app = createApp();
type Provider = "liqpay" | "monobank" | "wayforpay";

beforeEach(async () => {
  await resetDb();
  vi.clearAllMocks();
  providerMocks.verifyLiqpaySignature.mockReturnValue(true);
});

afterAll(async () => {
  await getRedis()?.quit();
  await closeDb();
});

async function postConfirmedCallback(provider: Provider, orderId: string) {
  if (provider === "liqpay") {
    providerMocks.decodeLiqpayCallback.mockReturnValue({
      order_id: orderId,
      status: "success",
      payment_id: `liqpay-${orderId}`
    });
    return request(app)
      .post("/payments/liqpay/callback")
      .type("form")
      .send({ data: "signed-data", signature: "valid-signature" });
  }
  if (provider === "monobank") {
    providerMocks.getMonobankInvoiceStatus.mockResolvedValue({
      invoiceId: `mono-${orderId}`,
      status: "success",
      amount: 2000,
      ccy: 980,
      reference: orderId
    });
    return request(app)
      .post("/payments/monobank/callback")
      .send({ invoiceId: `mono-${orderId}` });
  }

  providerMocks.getWayforpayStatus.mockResolvedValue({
    orderReference: orderId,
    transactionStatus: "Approved"
  });
  return request(app)
    .post("/payments/wayforpay/callback")
    .send({ orderReference: orderId });
}

describe("confirmed payment webhook retry semantics", () => {
  it("ACKs terminal/idempotent order outcomes for every provider", async () => {
    for (const provider of ["liqpay", "monobank", "wayforpay"] as const) {
      const seller = await createUser();
      const buyer = await createUser();
      const productId = await createProduct(seller, { priceCents: 2000 });
      const orderId = await createOrder(buyer, seller, productId, {
        amountCents: 2000,
        status: "paid"
      });

      const response = await postConfirmedCallback(provider, orderId);

      expect(response.status, provider).toBe(200);
      if (provider === "wayforpay") {
        expect(response.body).toMatchObject({ orderReference: orderId, status: "accept" });
      } else {
        expect(response.text).toBe("ok");
      }
    }
  });

  it("returns a generic retryable 503 for transient persistence failures for every provider", async () => {
    await pool.query(`drop trigger if exists test_fail_payment_capture on orders`);
    await pool.query(`drop function if exists test_fail_payment_capture_update()`);
    await pool.query(`
      create function test_fail_payment_capture_update() returns trigger as $$
      begin
        if old.status = 'pending' and new.status in ('paid', 'delivered') then
          raise exception 'private database outage detail' using errcode = '40001';
        end if;
        return new;
      end;
      $$ language plpgsql
    `);
    await pool.query(`
      create trigger test_fail_payment_capture
      before update on orders
      for each row execute function test_fail_payment_capture_update()
    `);

    try {
      for (const provider of ["liqpay", "monobank", "wayforpay"] as const) {
        const seller = await createUser();
        const buyer = await createUser();
        const productId = await createProduct(seller, { priceCents: 2000, stock: 5 });
        const orderId = await createOrder(buyer, seller, productId, { amountCents: 2000 });

        const response = await postConfirmedCallback(provider, orderId);

        expect(response.status, provider).toBe(503);
        expect(response.body).toMatchObject({
          error: {
            code: "service_unavailable",
            message: "Payment confirmation is temporarily unavailable"
          }
        });
        expect(JSON.stringify(response.body)).not.toContain("private database outage detail");
        expect((await getOrder(orderId)).status).toBe("pending");
        expect(Number((await getWallet(seller)).escrow_cents)).toBe(0);
        expect(
          (await pool.query(`select id from domain_outbox where aggregate_id = $1`, [orderId])).rows
        ).toHaveLength(0);
      }
    } finally {
      await pool.query(`drop trigger if exists test_fail_payment_capture on orders`);
      await pool.query(`drop function if exists test_fail_payment_capture_update()`);
    }
  });
});
