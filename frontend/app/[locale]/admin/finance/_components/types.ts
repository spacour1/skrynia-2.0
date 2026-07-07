export type Transaction = {
  id: string;
  type: string;
  direction: string;
  amountCents: number;
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
  debitCents: number;
  creditCents: number;
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
  walletAvailableCents: number;
  walletEscrowCents: number;
  ledgerPayableCents: number;
  ledgerEscrowCents: number;
  platformRevenueCents: number;
  ledgerRevenueCents: number;
  providerClearingCents: number;
  differenceCents: number;
  status: string;
  createdAt: string;
};

export type Overview = {
  revenue: { currency: string; revenueCents: number }[];
};

export type PendingOrder = {
  id: string;
  amountCents: number;
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
