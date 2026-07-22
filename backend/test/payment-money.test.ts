import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "../src/config/env.js";
import { buildLiqpayCheckout } from "../src/modules/payments/liqpay.service.js";
import { createMonobankInvoice } from "../src/modules/payments/monobank.service.js";
import { createWayforpayInvoice } from "../src/modules/payments/wayforpay.service.js";

const safeAmountCents = "54999";
const unsafeProviderAmountCents = "9007199254740993";
const originalProviderEnv = {
  liqpayPublicKey: env.LIQPAY_PUBLIC_KEY,
  liqpayPrivateKey: env.LIQPAY_PRIVATE_KEY,
  liqpayServerUrl: env.LIQPAY_SERVER_URL,
  monobankToken: env.MONOBANK_TOKEN,
  monobankWebhookUrl: env.MONOBANK_WEBHOOK_URL,
  wayforpayMerchantAccount: env.WAYFORPAY_MERCHANT_ACCOUNT,
  wayforpayMerchantSecretKey: env.WAYFORPAY_MERCHANT_SECRET_KEY,
  wayforpayServiceUrl: env.WAYFORPAY_SERVICE_URL
};

afterEach(() => {
  vi.unstubAllGlobals();
  env.LIQPAY_PUBLIC_KEY = originalProviderEnv.liqpayPublicKey;
  env.LIQPAY_PRIVATE_KEY = originalProviderEnv.liqpayPrivateKey;
  env.LIQPAY_SERVER_URL = originalProviderEnv.liqpayServerUrl;
  env.MONOBANK_TOKEN = originalProviderEnv.monobankToken;
  env.MONOBANK_WEBHOOK_URL = originalProviderEnv.monobankWebhookUrl;
  env.WAYFORPAY_MERCHANT_ACCOUNT = originalProviderEnv.wayforpayMerchantAccount;
  env.WAYFORPAY_MERCHANT_SECRET_KEY = originalProviderEnv.wayforpayMerchantSecretKey;
  env.WAYFORPAY_SERVICE_URL = originalProviderEnv.wayforpayServiceUrl;
});

describe("payment provider MoneyCents payloads", () => {
  it("keeps LiqPay decimal amounts as exact strings", () => {
    env.LIQPAY_PUBLIC_KEY = "test-public";
    env.LIQPAY_PRIVATE_KEY = "test-private";
    env.LIQPAY_SERVER_URL = "https://example.test/liqpay";

    const checkout = buildLiqpayCheckout({
      orderId: "order-1",
      amountCents: unsafeProviderAmountCents,
      currency: "UAH",
      description: "Exact amount",
      resultUrl: "https://example.test/result"
    });
    const payload = JSON.parse(
      Buffer.from(checkout.data, "base64").toString("utf8")
    ) as { amount: unknown };

    expect(payload.amount).toBe("90071992547409.93");
    expect(typeof payload.amount).toBe("string");
  });

  it("keeps Monobank integer cents exact on the provider wire", async () => {
    env.MONOBANK_TOKEN = "test-token";
    env.MONOBANK_WEBHOOK_URL = "https://example.test/mono";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ invoiceId: "invoice-1", pageUrl: "https://pay.test" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await createMonobankInvoice({
      reference: "order-1",
      amountCents: safeAmountCents,
      currency: "UAH",
      description: "Exact amount",
      redirectUrl: "https://example.test/result"
    });

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(request.body)) as { amount: unknown };
    expect(body.amount).toBe(54_999);
    expect(typeof body.amount).toBe("number");
  });

  it("preserves WayForPay's numeric contract after an exact cents round-trip check", async () => {
    env.WAYFORPAY_MERCHANT_ACCOUNT = "test-merchant";
    env.WAYFORPAY_MERCHANT_SECRET_KEY = "test-secret";
    env.WAYFORPAY_SERVICE_URL = "https://example.test/wayforpay";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ reasonCode: 1100, invoiceUrl: "https://pay.test" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await createWayforpayInvoice({
      orderReference: "order-1",
      amountCents: safeAmountCents,
      currency: "UAH",
      productName: "Exact amount"
    });

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(request.body)) as {
      amount: unknown;
      productPrice: unknown[];
    };
    expect(body.amount).toBe(549.99);
    expect(body.productPrice).toEqual([549.99]);
    expect(typeof body.amount).toBe("number");
  });

  it("rejects unsafe Monobank amounts before making a network call", async () => {
    env.MONOBANK_TOKEN = "test-token";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createMonobankInvoice({
        reference: "order-unsafe",
        amountCents: unsafeProviderAmountCents,
        currency: "UAH",
        description: "Unsafe amount",
        redirectUrl: "https://example.test/result"
      })
    ).rejects.toThrow(/provider's exact numeric range/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects unsafe WayForPay amounts before making a network call", async () => {
    env.WAYFORPAY_MERCHANT_ACCOUNT = "test-merchant";
    env.WAYFORPAY_MERCHANT_SECRET_KEY = "test-secret";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createWayforpayInvoice({
        orderReference: "order-unsafe",
        amountCents: unsafeProviderAmountCents,
        currency: "UAH",
        productName: "Unsafe amount"
      })
    ).rejects.toThrow(/provider's exact numeric range/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a safe integer whose WayForPay decimal number loses a cent", async () => {
    env.WAYFORPAY_MERCHANT_ACCOUNT = "test-merchant";
    env.WAYFORPAY_MERCHANT_SECRET_KEY = "test-secret";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createWayforpayInvoice({
        orderReference: "order-rounded",
        amountCents: "9007199254740990",
        currency: "UAH",
        productName: "Rounded amount"
      })
    ).rejects.toThrow(/cannot be represented exactly/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
