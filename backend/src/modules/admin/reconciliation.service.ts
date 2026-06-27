import { pool } from "../../db/pool.js";

type ReconciliationRow = {
  currency: string;
  wallet_available_cents: string | number;
  wallet_escrow_cents: string | number;
  ledger_payable_cents: string | number;
  ledger_escrow_cents: string | number;
  platform_revenue_cents: string | number;
  ledger_revenue_cents: string | number;
  provider_clearing_cents: string | number;
};

function toCents(value: string | number | null | undefined) {
  return Number(value ?? 0);
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
    const difference = Math.abs(walletAvailable - ledgerPayable)
      + Math.abs(walletEscrow - ledgerEscrow)
      + Math.abs(platformRevenue - ledgerRevenue);

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
        walletAvailable,
        walletEscrow,
        ledgerPayable,
        ledgerEscrow,
        platformRevenue,
        ledgerRevenue,
        providerClearing,
        difference,
        difference === 0 ? "balanced" : "mismatch",
        { generatedBy: "admin_reconciliation" }
      ]
    );
    snapshots.push(inserted.rows[0]);
  }

  return snapshots;
}
