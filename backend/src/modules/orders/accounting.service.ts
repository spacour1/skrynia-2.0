import type { DbClient } from "../../db/pool.js";
import { badRequest } from "../../common/errors.js";

type AccountType = "asset" | "liability" | "revenue" | "expense" | "equity";

type LedgerLineInput = {
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  userId?: string | null;
  debitCents?: number;
  creditCents?: number;
};

type LedgerEntryInput = {
  idempotencyKey: string;
  entryType: "payment_capture" | "escrow_release" | "refund" | "adjustment";
  orderId?: string | null;
  currency: string;
  metadata?: Record<string, unknown>;
  lines: LedgerLineInput[];
};

function accountCode(kind: string, currency: string, userId?: string | null) {
  return userId ? `${kind}:${currency}:${userId}` : `${kind}:${currency}`;
}

export const ledgerAccountCodes = {
  providerClearing: (currency: string) => accountCode("asset:provider-clearing", currency),
  sellerEscrow: (currency: string, sellerId: string) => accountCode("liability:seller-escrow", currency, sellerId),
  userPayable: (currency: string, userId: string) => accountCode("liability:user-payable", currency, userId),
  platformRevenue: (currency: string) => accountCode("revenue:platform-fee", currency)
};

async function ensureLedgerAccount(client: DbClient, line: LedgerLineInput, currency: string) {
  const result = await client.query<{ id: string }>(
    `insert into ledger_accounts(code, name, account_type, currency, user_id)
     values ($1, $2, $3, $4, $5)
     on conflict (code) do nothing
     returning id`,
    [line.accountCode, line.accountName, line.accountType, currency, line.userId ?? null]
  );
  if (result.rows[0]) return result.rows[0].id;

  const existing = await client.query<{ id: string }>(`select id from ledger_accounts where code = $1`, [
    line.accountCode
  ]);
  return existing.rows[0].id;
}

export async function postLedgerEntry(client: DbClient, input: LedgerEntryInput) {
  if (input.lines.length < 2) throw badRequest("Ledger entry must contain at least two lines");

  const debitTotal = input.lines.reduce((sum, line) => sum + Number(line.debitCents ?? 0), 0);
  const creditTotal = input.lines.reduce((sum, line) => sum + Number(line.creditCents ?? 0), 0);
  if (debitTotal <= 0 || debitTotal !== creditTotal) {
    throw badRequest("Ledger entry is not balanced");
  }

  const entry = await client.query<{ id: string }>(
    `insert into ledger_entries(idempotency_key, entry_type, order_id, currency, metadata)
     values ($1, $2, $3, $4, $5)
     on conflict (idempotency_key) do nothing
     returning id`,
    [input.idempotencyKey, input.entryType, input.orderId ?? null, input.currency, input.metadata ?? {}]
  );
  if (!entry.rows[0]) return null;

  for (const line of input.lines) {
    const accountId = await ensureLedgerAccount(client, line, input.currency);
    await client.query(
      `insert into ledger_lines(entry_id, account_id, debit_cents, credit_cents, currency)
       values ($1, $2, $3, $4, $5)`,
      [entry.rows[0].id, accountId, line.debitCents ?? 0, line.creditCents ?? 0, input.currency]
    );
  }

  return entry.rows[0].id;
}

export async function recordPaymentCaptureLedger(params: {
  client: DbClient;
  orderId: string;
  sellerId: string;
  amountCents: number;
  currency: string;
  provider: string;
  reference: string;
}) {
  await postLedgerEntry(params.client, {
    idempotencyKey: `order:${params.orderId}:payment_capture`,
    entryType: "payment_capture",
    orderId: params.orderId,
    currency: params.currency,
    metadata: { provider: params.provider, reference: params.reference },
    lines: [
      {
        accountCode: ledgerAccountCodes.providerClearing(params.currency),
        accountName: `${params.currency} provider clearing`,
        accountType: "asset",
        debitCents: params.amountCents
      },
      {
        accountCode: ledgerAccountCodes.sellerEscrow(params.currency, params.sellerId),
        accountName: `${params.currency} seller escrow liability`,
        accountType: "liability",
        userId: params.sellerId,
        creditCents: params.amountCents
      }
    ]
  });
}

export async function recordEscrowReleaseLedger(params: {
  client: DbClient;
  orderId: string;
  sellerId: string;
  amountCents: number;
  feeCents: number;
  currency: string;
  adminId?: string | null;
}) {
  const netCents = params.amountCents - params.feeCents;
  await postLedgerEntry(params.client, {
    idempotencyKey: `order:${params.orderId}:escrow_release`,
    entryType: "escrow_release",
    orderId: params.orderId,
    currency: params.currency,
    metadata: { adminId: params.adminId ?? null },
    lines: [
      {
        accountCode: ledgerAccountCodes.sellerEscrow(params.currency, params.sellerId),
        accountName: `${params.currency} seller escrow liability`,
        accountType: "liability",
        userId: params.sellerId,
        debitCents: params.amountCents
      },
      {
        accountCode: ledgerAccountCodes.userPayable(params.currency, params.sellerId),
        accountName: `${params.currency} user payable liability`,
        accountType: "liability",
        userId: params.sellerId,
        creditCents: netCents
      },
      {
        accountCode: ledgerAccountCodes.platformRevenue(params.currency),
        accountName: `${params.currency} platform fee revenue`,
        accountType: "revenue",
        creditCents: params.feeCents
      }
    ]
  });
}

export async function recordWalletTopupLedger(params: {
  client: DbClient;
  userId: string;
  amountCents: number;
  currency: string;
  provider: string;
  reference: string;
  topupId: string;
}) {
  await postLedgerEntry(params.client, {
    idempotencyKey: `wallet_topup:${params.topupId}`,
    entryType: "adjustment",
    currency: params.currency,
    metadata: { provider: params.provider, reference: params.reference, kind: "wallet_topup" },
    lines: [
      {
        accountCode: ledgerAccountCodes.providerClearing(params.currency),
        accountName: `${params.currency} provider clearing`,
        accountType: "asset",
        debitCents: params.amountCents
      },
      {
        accountCode: ledgerAccountCodes.userPayable(params.currency, params.userId),
        accountName: `${params.currency} user payable liability`,
        accountType: "liability",
        userId: params.userId,
        creditCents: params.amountCents
      }
    ]
  });
}

export async function recordWalletWithdrawalLedger(params: {
  client: DbClient;
  transactionId: string;
  userId: string;
  amountCents: number;
  currency: string;
}) {
  await postLedgerEntry(params.client, {
    idempotencyKey: `wallet_withdrawal:${params.transactionId}`,
    entryType: "adjustment",
    currency: params.currency,
    metadata: { kind: "wallet_withdrawal" },
    lines: [
      {
        accountCode: ledgerAccountCodes.userPayable(params.currency, params.userId),
        accountName: `${params.currency} user payable liability`,
        accountType: "liability",
        userId: params.userId,
        debitCents: params.amountCents
      },
      {
        accountCode: ledgerAccountCodes.providerClearing(params.currency),
        accountName: `${params.currency} provider clearing`,
        accountType: "asset",
        creditCents: params.amountCents
      }
    ]
  });
}

export async function recordRefundLedger(params: {
  client: DbClient;
  orderId: string;
  sellerId: string;
  buyerId: string;
  amountCents: number;
  currency: string;
  adminId?: string | null;
}) {
  await postLedgerEntry(params.client, {
    idempotencyKey: `order:${params.orderId}:refund`,
    entryType: "refund",
    orderId: params.orderId,
    currency: params.currency,
    metadata: { adminId: params.adminId ?? null },
    lines: [
      {
        accountCode: ledgerAccountCodes.sellerEscrow(params.currency, params.sellerId),
        accountName: `${params.currency} seller escrow liability`,
        accountType: "liability",
        userId: params.sellerId,
        debitCents: params.amountCents
      },
      {
        accountCode: ledgerAccountCodes.userPayable(params.currency, params.buyerId),
        accountName: `${params.currency} user payable liability`,
        accountType: "liability",
        userId: params.buyerId,
        creditCents: params.amountCents
      }
    ]
  });
}
