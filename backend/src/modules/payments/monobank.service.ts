import { env } from "../../config/env.js";
import { badRequest } from "../../common/errors.js";

const API_BASE = "https://api.monobank.ua/api/merchant";

const CURRENCY_NUMERIC_CODES: Record<string, number> = {
  UAH: 980,
  USD: 840,
  EUR: 978
};

export type MonobankInvoice = {
  invoiceId: string;
  pageUrl: string;
};

export type MonobankInvoiceStatus = {
  invoiceId: string;
  status: string;
  amount: number;
  ccy: number;
  reference?: string;
};

function requireConfig() {
  if (!env.MONOBANK_TOKEN) {
    throw badRequest("Monobank is not configured on this server");
  }
  return { token: env.MONOBANK_TOKEN };
}

function currencyCode(currency: string) {
  const code = CURRENCY_NUMERIC_CODES[currency.toUpperCase()];
  if (!code) throw badRequest(`Unsupported currency for Monobank: ${currency}`);
  return code;
}

/**
 * Creates a hosted Monobank Acquiring invoice. `reference` carries our own order/top-up
 * id so the webhook can tell us which record to settle without us needing to track
 * Monobank's invoiceId up front.
 */
export async function createMonobankInvoice(input: {
  reference: string;
  amountCents: number;
  currency: string;
  description: string;
  redirectUrl: string;
}): Promise<MonobankInvoice> {
  const { token } = requireConfig();

  const response = await fetch(`${API_BASE}/invoice/create`, {
    method: "POST",
    headers: { "X-Token": token, "Content-Type": "application/json" },
    body: JSON.stringify({
      amount: input.amountCents,
      ccy: currencyCode(input.currency),
      merchantPaymInfo: { reference: input.reference, destination: input.description },
      redirectUrl: input.redirectUrl,
      webHookUrl: env.MONOBANK_WEBHOOK_URL,
      validity: 3600
    })
  });

  if (!response.ok) {
    throw badRequest(`Monobank invoice creation failed: ${await response.text()}`);
  }

  const body = (await response.json()) as { invoiceId: string; pageUrl: string };
  return { invoiceId: body.invoiceId, pageUrl: body.pageUrl };
}

/**
 * The webhook payload itself isn't treated as trusted input — we re-fetch the invoice
 * status here with our own merchant token and act on that response instead. That avoids
 * needing to verify Monobank's ECDSA webhook signature while still only ever trusting
 * data that came back from a request we made ourselves.
 */
export async function getMonobankInvoiceStatus(invoiceId: string): Promise<MonobankInvoiceStatus> {
  const { token } = requireConfig();

  const response = await fetch(`${API_BASE}/invoice/status?invoiceId=${encodeURIComponent(invoiceId)}`, {
    headers: { "X-Token": token }
  });

  if (!response.ok) {
    throw badRequest(`Monobank invoice status lookup failed: ${await response.text()}`);
  }

  return (await response.json()) as MonobankInvoiceStatus;
}

export function isMonobankSuccessStatus(status: string) {
  return status === "success";
}
