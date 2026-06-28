import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  simulateTestPaymentFailure,
  simulateTestPaymentSuccess,
  simulateTestPaymentWaitAccept
} from "../src/modules/payments/test-payments.service.js";
import { closeDb, createOrder, createProduct, createUser, getOrder, getWallet, resetDb } from "./fixtures.js";

beforeEach(resetDb);
afterAll(closeDb);

describe("simulateTestPaymentSuccess", () => {
  it("locks escrow just like a real mock payment", async () => {
    const seller = await createUser("seller");
    const buyer = await createUser();
    const productId = await createProduct(seller, { priceCents: 2000 });
    const orderId = await createOrder(buyer, seller, productId, { amountCents: 2000 });

    const updated = await simulateTestPaymentSuccess(orderId, buyer);

    expect(updated.status).toBe("paid");
    const sellerWallet = await getWallet(seller);
    expect(Number(sellerWallet.escrow_cents)).toBe(2000);
  });

  it("rejects a second success call on the same order instead of double-crediting escrow", async () => {
    const seller = await createUser("seller");
    const buyer = await createUser();
    const productId = await createProduct(seller, { priceCents: 2000 });
    const orderId = await createOrder(buyer, seller, productId, { amountCents: 2000 });

    await simulateTestPaymentSuccess(orderId, buyer);
    await expect(simulateTestPaymentSuccess(orderId, buyer)).rejects.toThrow("Only pending orders can be paid");

    const sellerWallet = await getWallet(seller);
    expect(Number(sellerWallet.escrow_cents)).toBe(2000);
  });

  it("rejects a buyer simulating payment on someone else's order", async () => {
    const seller = await createUser("seller");
    const buyer = await createUser();
    const intruder = await createUser();
    const productId = await createProduct(seller);
    const orderId = await createOrder(buyer, seller, productId);

    await expect(simulateTestPaymentSuccess(orderId, intruder)).rejects.toThrow();
  });
});

describe("simulateTestPaymentFailure", () => {
  it("cancels a pending order without touching escrow", async () => {
    const seller = await createUser("seller");
    const buyer = await createUser();
    const productId = await createProduct(seller);
    const orderId = await createOrder(buyer, seller, productId);

    const updated = await simulateTestPaymentFailure(orderId, buyer);

    expect(updated.status).toBe("canceled");
    const sellerWallet = await getWallet(seller);
    expect(Number(sellerWallet.escrow_cents)).toBe(0);
  });

  it("rejects failing an order that was already paid", async () => {
    const seller = await createUser("seller");
    const buyer = await createUser();
    const productId = await createProduct(seller);
    const orderId = await createOrder(buyer, seller, productId);

    await simulateTestPaymentSuccess(orderId, buyer);
    await expect(simulateTestPaymentFailure(orderId, buyer)).rejects.toThrow(
      "Only a pending order's payment can be simulated as failed"
    );
  });
});

describe("simulateTestPaymentWaitAccept", () => {
  it("leaves the order pending and unchanged", async () => {
    const seller = await createUser("seller");
    const buyer = await createUser();
    const productId = await createProduct(seller);
    const orderId = await createOrder(buyer, seller, productId);

    await simulateTestPaymentWaitAccept(orderId, buyer);

    const order = await getOrder(orderId);
    expect(order.status).toBe("pending");
  });
});
