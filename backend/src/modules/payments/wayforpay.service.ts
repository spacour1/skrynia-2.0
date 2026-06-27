import { createHmac } from "node:crypto";
import { env } from "../../config/env.js";
import { badRequest } from "../../common/errors.js";
import { centsToDecimalString } from "../../common/validation.js";

const API_URL = "https://api.wayforpay.com/api";

function requireConfig() {
  if (!env.WAYFORPAY_MERCHANT_ACCOUNT || !env.WAYFORPAY_MERCHANT_SECRET_KEY) {
    throw badRequest("WayForPay is not configured on this server");
  }
  return { merchantAccount: env.WAYFORPAY_MERCHANT_ACCOUNT, secretKey: env.WAYFORPAY_MERCHANT_SECRET_KEY };
}

function sign(secretKey: string, fields: (string | number)[]) {
  return createHmac("md5", secretKey).update(fields.join(";")).digest("hex");
}

/** WayForPay's signature ties a shop to the domain it was registered under. */
function domainName() {
  return new URL(env.FRONTEND_URL).host;
}

export type WayforpayInvoice = { invoiceUrl: string; orderReference: string };

export async function createWayforpayInvoice(input: {
  orderReference: string;
  amountCents: number;
  currency: string;
  productName: string;
}): Promise<WayforpayInvoice> {
  const { merchantAccount, secretKey } = requireConfig();
  const orderDate = Math.floor(Date.now() / 1000);
  const amount = centsToDecimalString(input.amountCents);

  const signature = sign(secretKey, [
    merchantAccount,
    domainName(),
    input.orderReference,
    orderDate,
    amount,
    input.currency,
    input.productName,
    1,
    amount
  ]);

  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      transactionType: "CREATE_INVOICE",
      merchantAccount,
      merchantAuthType: "SimpleSignature",
      merchantDomainName: domainName(),
      merchantSignature: signature,
      apiVersion: 1,
      language: "UA",
      serviceUrl: env.WAYFORPAY_SERVICE_URL,
      orderReference: input.orderReference,
      orderDate,
      amount: Number(amount),
      currency: input.currency,
      orderTimeout: 49000,
      productName: [input.productName],
      productCount: [1],
      productPrice: [Number(amount)]
    })
  });

  const body = (await response.json().catch(() => null)) as
    | { reasonCode?: number; reason?: string; invoiceUrl?: string }
    | null;
  if (!response.ok || !body || body.reasonCode !== 1100 || !body.invoiceUrl) {
    throw badRequest(`WayForPay invoice creation failed: ${body?.reason ?? "unknown error"}`);
  }
  return { invoiceUrl: body.invoiceUrl, orderReference: input.orderReference };
}

export type WayforpayStatus = { orderReference: string; transactionStatus?: string; reason?: string };

/**
 * Like the Monobank webhook, we don't verify WayForPay's merchantSignature on the
 * incoming webhook body itself — we use it only to know which orderReference to look up,
 * then re-check status ourselves with our own merchant credentials.
 */
export async function getWayforpayStatus(orderReference: string): Promise<WayforpayStatus> {
  const { merchantAccount, secretKey } = requireConfig();
  const signature = sign(secretKey, [merchantAccount, orderReference]);

  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      transactionType: "CHECK_STATUS",
      merchantAccount,
      orderReference,
      merchantSignature: signature,
      apiVersion: 1
    })
  });

  return (await response.json()) as WayforpayStatus;
}

export function isWayforpaySuccessStatus(status?: string) {
  return status === "Approved";
}

/** WayForPay keeps retrying the webhook until it gets this exact acknowledgment back. */
export function buildWayforpayAck(orderReference: string) {
  const { secretKey } = requireConfig();
  const time = Math.floor(Date.now() / 1000);
  const signature = sign(secretKey, [orderReference, "accept", time]);
  return { orderReference, status: "accept", time, signature };
}
