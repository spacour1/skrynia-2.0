import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { asyncHandler } from "../../common/errors.js";
import { requireRole } from "../../common/middleware/rbac.js";
import type { AuthedRequest } from "../../common/types.js";
import { createReconciliationSnapshot } from "./reconciliation.service.js";
import { postManualAdjustment } from "../users/wallet.service.js";

const router = Router();
const adminOnly = requireRole("admin");

router.get(
  "/transactions",
  adminOnly,
  asyncHandler(async (_req: AuthedRequest, res) => {
    const result = await pool.query(
      `select t.id, t.type, t.direction, t.amount_cents as "amountCents", t.currency, t.status,
              t.created_at as "createdAt", t.order_id as "orderId",
              u.email, u.display_name as "displayName"
       from transactions t
       left join users u on u.id = t.user_id
       order by t.created_at desc
       limit 300`
    );
    res.json({ transactions: result.rows });
  })
);

router.get(
  "/ledger",
  adminOnly,
  asyncHandler(async (_req: AuthedRequest, res) => {
    const result = await pool.query(
      `select e.id, e.idempotency_key as "idempotencyKey", e.entry_type as "entryType",
              e.order_id as "orderId", e.currency, e.metadata, e.created_at as "createdAt",
              coalesce(
                json_agg(
                  json_build_object(
                    'id', l.id,
                    'accountCode', a.code,
                    'accountName', a.name,
                    'accountType', a.account_type,
                    'userId', a.user_id,
                    'debitCents', l.debit_cents,
                    'creditCents', l.credit_cents
                  )
                  order by l.created_at, l.id
                ) filter (where l.id is not null),
                '[]'::json
              ) as lines
       from ledger_entries e
       left join ledger_lines l on l.entry_id = e.id
       left join ledger_accounts a on a.id = l.account_id
       group by e.id
       order by e.created_at desc
       limit 200`
    );
    res.json({ entries: result.rows });
  })
);

router.post(
  "/reconciliation/run",
  adminOnly,
  asyncHandler(async (_req: AuthedRequest, res) => {
    const snapshots = await createReconciliationSnapshot();
    res.status(201).json({ snapshots });
  })
);

router.get(
  "/reconciliation",
  adminOnly,
  asyncHandler(async (_req: AuthedRequest, res) => {
    const result = await pool.query(
      `select id, currency,
              wallet_available_cents as "walletAvailableCents",
              wallet_escrow_cents as "walletEscrowCents",
              ledger_payable_cents as "ledgerPayableCents",
              ledger_escrow_cents as "ledgerEscrowCents",
              platform_revenue_cents as "platformRevenueCents",
              ledger_revenue_cents as "ledgerRevenueCents",
              provider_clearing_cents as "providerClearingCents",
              difference_cents as "differenceCents",
              status, metadata, created_at as "createdAt"
       from reconciliation_snapshots
       order by created_at desc
       limit 100`
    );
    res.json({ snapshots: result.rows });
  })
);

/** CSV export of recent reconciliation snapshots, for handing to finance/accounting outside the app. */
router.get(
  "/reconciliation/export",
  adminOnly,
  asyncHandler(async (_req: AuthedRequest, res) => {
    const result = await pool.query(
      `select currency, wallet_available_cents as "walletAvailableCents",
              wallet_escrow_cents as "walletEscrowCents", ledger_payable_cents as "ledgerPayableCents",
              ledger_escrow_cents as "ledgerEscrowCents", platform_revenue_cents as "platformRevenueCents",
              ledger_revenue_cents as "ledgerRevenueCents", provider_clearing_cents as "providerClearingCents",
              difference_cents as "differenceCents", status, created_at as "createdAt"
       from reconciliation_snapshots
       order by created_at desc
       limit 1000`
    );
    const header = [
      "createdAt", "currency", "walletAvailableCents", "walletEscrowCents", "ledgerPayableCents",
      "ledgerEscrowCents", "platformRevenueCents", "ledgerRevenueCents", "providerClearingCents",
      "differenceCents", "status"
    ];
    const csvRows = result.rows.map((row) =>
      header.map((key) => String((row as Record<string, unknown>)[key] ?? "")).join(",")
    );
    const csv = [header.join(","), ...csvRows].join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="reconciliation-${Date.now()}.csv"`);
    res.send(csv);
  })
);

/**
 * Cross-checks completed payouts against the ledger's record of those same withdrawals, per
 * currency. A payout that's "paid" in the payouts table but whose ledger withdrawal entry is
 * missing (or vice versa) means the two systems disagree about whether money actually left.
 */
router.get(
  "/reconciliation/payouts",
  adminOnly,
  asyncHandler(async (_req: AuthedRequest, res) => {
    const result = await pool.query(
      `select p.currency,
              coalesce(sum(p.amount_cents) filter (where p.status = 'paid'), 0)::bigint as "payoutsPaidCents",
              coalesce(sum(p.amount_cents) filter (where p.status = 'pending'), 0)::bigint as "payoutsPendingCents"
       from payouts p
       group by p.currency`
    );
    // Ledger withdrawal entries are keyed by transaction id (wallet_withdrawal:<transactionId>),
    // so cross-check via the transactions row each payout was created from instead of joining
    // ledger_lines directly to payouts (which has no FK between them).
    const ledgerCheck = await pool.query(
      `select p.currency,
              count(*) filter (where p.status = 'paid' and le.id is null)::int as "paidWithoutLedgerEntry"
       from payouts p
       join transactions t on t.id = p.transaction_id
       left join ledger_entries le on le.idempotency_key = 'wallet_withdrawal:' || t.id::text
       group by p.currency`
    );
    const byCurrency = new Map(result.rows.map((row) => [row.currency, row]));
    for (const row of ledgerCheck.rows) {
      const existing = byCurrency.get(row.currency);
      if (existing) existing.paidWithoutLedgerEntry = row.paidWithoutLedgerEntry;
    }
    res.json({ payoutReconciliation: Array.from(byCurrency.values()) });
  })
);

const manualAdjustmentSchema = z.object({
  userId: z.string().uuid(),
  amountCents: z.coerce.number().int().refine((value) => value !== 0, "Amount cannot be zero"),
  currency: z.string().length(3).default("UAH"),
  reason: z.string().trim().min(3).max(1000)
});

/** Manual wallet correction with a mandatory reason - the ledger and transaction history both record it, the user-facing wallet just sees a balance change. */
router.post(
  "/ledger/adjustments",
  adminOnly,
  asyncHandler(async (req: AuthedRequest, res) => {
    const input = manualAdjustmentSchema.parse(req.body);
    const adjustment = await postManualAdjustment({
      userId: input.userId,
      amountCents: input.amountCents,
      currency: input.currency.toUpperCase(),
      reason: input.reason,
      adminId: req.user.id
    });
    res.status(201).json({ adjustment });
  })
);

export default router;
