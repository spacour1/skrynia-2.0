import { pool } from "../../db/pool.js";
import {
  bigintToMoneyCents,
  parseMoneyCents,
  type MoneyCentsInput
} from "../../domain/money.js";

type ReconciliationRow = {
  currency: string;
  wallet_available_cents: MoneyCentsInput;
  wallet_escrow_cents: MoneyCentsInput;
  ledger_payable_cents: MoneyCentsInput;
  ledger_escrow_cents: MoneyCentsInput;
  platform_revenue_cents: MoneyCentsInput;
  ledger_revenue_cents: MoneyCentsInput;
  provider_clearing_cents: MoneyCentsInput;
};

function toCents(value: MoneyCentsInput | null | undefined) {
  return parseMoneyCents(bigintToMoneyCents(value ?? 0));
}

function abs(value: bigint) {
  return value < 0n ? -value : value;
}

export async function createReconciliationSnapshot() {
  const result = await pool.query<ReconciliationRow>(
    `with currencies as (
       select currency from wallets
       union
       select currency from platform_wallets
       union
       select currency from ledger_accounts
     ),
     wallet_totals as (
       select currency,
              coalesce(sum(available_cents), 0) as wallet_available_cents,
              coalesce(sum(escrow_cents), 0) as wallet_escrow_cents
       from wallets
       group by currency
     ),
     platform_totals as (
       select currency, coalesce(sum(revenue_cents), 0) as platform_revenue_cents
       from platform_wallets
       group by currency
     ),
     ledger_totals as (
       select la.currency,
              coalesce(sum(case when la.code like 'liability:user-payable:%' then ll.credit_cents - ll.debit_cents else 0 end), 0) as ledger_payable_cents,
              coalesce(sum(case when la.code like 'liability:seller-escrow:%' then ll.credit_cents - ll.debit_cents else 0 end), 0) as ledger_escrow_cents,
              coalesce(sum(case when la.code like 'revenue:platform-fee:%' then ll.credit_cents - ll.debit_cents else 0 end), 0) as ledger_revenue_cents,
              coalesce(sum(case when la.code like 'asset:provider-clearing:%' then ll.debit_cents - ll.credit_cents else 0 end), 0) as provider_clearing_cents
       from ledger_accounts la
       left join ledger_lines ll on ll.account_id = la.id
       group by la.currency
     )
     select c.currency,
            coalesce(w.wallet_available_cents, 0) as wallet_available_cents,
            coalesce(w.wallet_escrow_cents, 0) as wallet_escrow_cents,
            coalesce(l.ledger_payable_cents, 0) as ledger_payable_cents,
            coalesce(l.ledger_escrow_cents, 0) as ledger_escrow_cents,
            coalesce(p.platform_revenue_cents, 0) as platform_revenue_cents,
            coalesce(l.ledger_revenue_cents, 0) as ledger_revenue_cents,
            coalesce(l.provider_clearing_cents, 0) as provider_clearing_cents
     from currencies c
     left join wallet_totals w on w.currency = c.currency
     left join platform_totals p on p.currency = c.currency
     left join ledger_totals l on l.currency = c.currency
     order by c.currency`
  );

  const snapshots = [];
  for (const row of result.rows) {
    const walletAvailable = toCents(row.wallet_available_cents);
    const walletEscrow = toCents(row.wallet_escrow_cents);
    const ledgerPayable = toCents(row.ledger_payable_cents);
    const ledgerEscrow = toCents(row.ledger_escrow_cents);
    const platformRevenue = toCents(row.platform_revenue_cents);
    const ledgerRevenue = toCents(row.ledger_revenue_cents);
    const providerClearing = toCents(row.provider_clearing_cents);
    const difference =
      abs(walletAvailable - ledgerPayable) +
      abs(walletEscrow - ledgerEscrow) +
      abs(platformRevenue - ledgerRevenue);

    const inserted = await pool.query(
      `insert into reconciliation_snapshots(
         currency,
         wallet_available_cents,
         wallet_escrow_cents,
         ledger_payable_cents,
         ledger_escrow_cents,
         platform_revenue_cents,
         ledger_revenue_cents,
         provider_clearing_cents,
         difference_cents,
         status,
         metadata
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       returning id, currency, wallet_available_cents as "walletAvailableCents",
                 wallet_escrow_cents as "walletEscrowCents",
                 ledger_payable_cents as "ledgerPayableCents",
                 ledger_escrow_cents as "ledgerEscrowCents",
                 platform_revenue_cents as "platformRevenueCents",
                 ledger_revenue_cents as "ledgerRevenueCents",
                 provider_clearing_cents as "providerClearingCents",
                 difference_cents as "differenceCents",
                 status, metadata, created_at as "createdAt"`,
      [
        row.currency,
        bigintToMoneyCents(walletAvailable),
        bigintToMoneyCents(walletEscrow),
        bigintToMoneyCents(ledgerPayable),
        bigintToMoneyCents(ledgerEscrow),
        bigintToMoneyCents(platformRevenue),
        bigintToMoneyCents(ledgerRevenue),
        bigintToMoneyCents(providerClearing),
        bigintToMoneyCents(difference),
        difference === 0n ? "balanced" : "mismatch",
        { generatedBy: "admin_reconciliation" }
      ]
    );
    snapshots.push(inserted.rows[0]);
  }

  return snapshots;
}
