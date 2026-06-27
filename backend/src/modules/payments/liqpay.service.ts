import { createHash } from "node:crypto";
import { env } from "../../config/env.js";
import { badRequest } from "../../common/errors.js";
import { centsToDecimalString } from "../../common/validation.js";

const CHECKOUT_ACTION_URL = "https://www.liqpay.ua/api/3/checkout";

/** Statuses LiqPay reports for a fully completed, money-in-hand payment. */
const SUCCESS_STATUSES = new Set(["success", "sandbox"]);

export type LiqpayCheckoutRequest = {
  data: string;
  signature: string;
  actionUrl: string;
};

export type LiqpayCallbackPayload = {
  order_id: string;
  status: string;
  payment_id?: number | string;
  amount?: number;
  currency?: string;
  err_description?: string;
};

function requireConfig() {
  if (!env.LIQPAY_PUBLIC_KEY || !env.LIQPAY_PRIVATE_KEY) {
    throw badRequest("LiqPay is not configured on this server");
  }
  return { publicKey: env.LIQPAY_PUBLIC_KEY, privateKey: env.LIQPAY_PRIVATE_KEY };
}

function sign(privateKey: string, data: string) {
  return createHash("sha1").update(privateKey + data + privateKey).digest("base64");
}

/**
 * Builds the classic LiqPay CNB checkout request: a base64 JSON payload plus its
 * signature, meant to be POSTed by the browser (as a hidden auto-submitting form) to
 * LiqPay's hosted checkout. LiqPay itself collects card details and 3-D Secure there —
 * this backend never touches card data.
 */
export function buildLiqpayCheckout(input: {
  orderId: string;
  amountCents: number;
  currency: string;
  description: string;
  resultUrl: string;
}): LiqpayCheckoutRequest {
  const { publicKey, privateKey } = requireConfig();

  const payload = {
    version: 3,
    public_key: publicKey,
    action: "pay",
    amount: centsToDecimalString(input.amountCents),
    currency: input.currency,
    description: input.description,
    order_id: input.orderId,
    result_url: input.resultUrl,
    server_url: env.LIQPAY_SERVER_URL,
    language: "uk"
  };

  const data = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  const signature = sign(privateKey, data);
  return { data, signature, actionUrl: CHECKOUT_ACTION_URL };
}

export function verifyLiqpaySignature(data: string, signature: string): boolean {
  const { privateKey } = requireConfig();
  const expected = sign(privateKey, data);
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signature);
  if (expectedBuf.length !== actualBuf.length) return false;
  return expectedBuf.equals(actualBuf);
}

export function decodeLiqpayCallback(data: string): LiqpayCallbackPayload {
  const json = Buffer.from(data, "base64").toString("utf8");
  return JSON.parse(json) as LiqpayCallbackPayload;
}

export function isLiqpaySuccessStatus(status: string) {
  return SUCCESS_STATUSES.has(status);
}
