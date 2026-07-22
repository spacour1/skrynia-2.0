import type { WireMoneyCents } from "@/lib/currency";

export type Transaction = {
  id: string;
  type: string;
  direction: string;
  amountCents: WireMoneyCents;
  currency: string;
  status: string;
  orderId?: string | null;
  email?: string | null;
  displayName?: string | null;
  createdAt: string;
};

export type LedgerLine = {
  id: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  userId?: string | null;
  debitCents: WireMoneyCents;
  creditCents: WireMoneyCents;
};

export type LedgerEntry = {
  id: string;
  idempotencyKey: string;
  entryType: string;
  orderId?: string | null;
  currency: string;
  createdAt: string;
  lines: LedgerLine[];
};

export type ReconciliationSnapshot = {
  id: string;
  currency: string;
  walletAvailableCents: WireMoneyCents;
  walletEscrowCents: WireMoneyCents;
  ledgerPayableCents: WireMoneyCents;
  ledgerEscrowCents: WireMoneyCents;
  platformRevenueCents: WireMoneyCents;
  ledgerRevenueCents: WireMoneyCents;
  providerClearingCents: WireMoneyCents;
  differenceCents: WireMoneyCents;
  status: string;
  createdAt: string;
};

export type Overview = {
  revenue: { currency: string; revenueCents: WireMoneyCents }[];
};

export type PendingOrder = {
  id: string;
  amountCents: WireMoneyCents;
  currency: string;
  createdAt: string;
  productTitle: string;
  buyerDisplayName: string;
  buyerEmail: string;
  sellerDisplayName: string;
};

export type Filters = {
  query: string;
  currency: string;
  type: string;
  status: string;
};
