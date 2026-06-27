import { pool } from "../../db/pool.js";
import { inSerializableTx } from "../../db/pool.js";
import { badRequest, notFound } from "../../common/errors.js";
import { cacheDel } from "../../common/redis.js";
import { ensureWallet } from "../orders/ledger.service.js";
import {
  recordWalletTopupLedger,
  recordWalletWithdrawalLedger,
  recordWalletWithdrawalReversalLedger
} from "../orders/accounting.service.js";
import type { PayoutDestination } from "../payments/payout.providers.js";
import { getPayoutProvider } from "../payments/payout.providers.js";

export async function createWalletTopup(userId: string, amountCents: number, currency: string) {
  const result = await pool.query(
    `insert into wallet_topups(user_id, amount_cents, currency)
     values ($1, $2, $3)
     returning id, user_id as "userId", amount_cents as "amountCents", currency, status`,
    [userId, amountCents, currency]
  );
  return result.rows[0];
}

/**
 * Called from the LiqPay webhook. Guarded by `status = 'pending'` the same way
 * lockEscrow guards orders, so a redelivered webhook is a no-op instead of a double credit.
 */
export async function completeWalletTopup(topupId: string, provider: string, reference: string) {
  return inSerializableTx(async (client) => {
    const topupResult = await client.query(`select * from wallet_topups where id = $1 for update`, [topupId]);
    const topup = topupResult.rows[0];
    if (!topup) throw notFound("Wallet topup not found");
    if (topup.status !== "pending") return topup;

    const walletId = await ensureWallet(client, topup.user_id, topup.currency);
    await client.query(
      `update wallets set available_cents = available_cents + $2, updated_at = now() where id = $1`,
      [walletId, topup.amount_cents]
    );
    await client.query(
      `insert into transactions(wallet_id, user_id, type, direction, amount_cents, currency, metadata)
       values ($1, $2, 'wallet_credit', 'credit', $3, $4, $5)`,
      [walletId, topup.user_id, topup.amount_cents, topup.currency, { provider, reference }]
    );
    await recordWalletTopupLedger({
      client,
      userId: topup.user_id,
      amountCents: Number(topup.amount_cents),
      currency: topup.currency,
      provider,
      reference,
      topupId: topup.id
    });

    const updated = await client.query(
      `update wallet_topups
       set status = 'completed', payment_provider = $2, payment_reference = $3, completed_at = now()
       where id = $1
       returning *`,
      [topup.id, provider, reference]
    );
    await cacheDel(`user:${topup.user_id}:wallet`);
    return updated.rows[0];
  });
}

/**
 * Reserves the balance immediately (same as a confirmed debit) and opens a `payouts` row
 * an admin must action: there's no automated bank rail wired up yet, so until one exists
 * every withdrawal goes through manual review and a hand-confirmed bank transfer.
 */
export async function requestWithdrawal(
  userId: string,
  amountCents: number,
  currency: string,
  destination: PayoutDestination
) {
  return inSerializableTx(async (client) => {
    const walletId = await ensureWallet(client, userId, currency);
    const walletResult = await client.query<{ available_cents: number }>(
      `select available_cents from wallets where id = $1 for update`,
      [walletId]
    );
    const available = Number(walletResult.rows[0].available_cents);
    if (available < amountCents) throw badRequest("Insufficient balance");

    await client.query(
      `update wallets set available_cents = available_cents - $2, updated_at = now() where id = $1`,
      [walletId, amountCents]
    );
    const tx = await client.query(
      `insert into transactions(wallet_id, user_id, type, direction, amount_cents, currency, status, metadata)
       values ($1, $2, 'wallet_debit', 'debit', $3, $4, 'pending', $5)
       returning id`,
      [walletId, userId, amountCents, currency, { destination }]
    );
    await recordWalletWithdrawalLedger({
      client,
      transactionId: tx.rows[0].id,
      userId,
      amountCents,
      currency
    });
    const payout = await client.query(
      `insert into payouts(user_id, transaction_id, amount_cents, currency, provider, destination, status)
       values ($1, $2, $3, $4, 'manual', $5, 'pending')
       returning id, user_id as "userId", amount_cents as "amountCents", currency, provider, destination, status,
                 created_at as "createdAt"`,
      [userId, tx.rows[0].id, amountCents, currency, destination]
    );
    await cacheDel(`user:${userId}:wallet`);
    return payout.rows[0];
  });
}

export async function listPayouts(status?: string) {
  const result = await pool.query(
    `select p.id, p.user_id as "userId", u.display_name as "userDisplayName", u.email as "userEmail",
            p.amount_cents as "amountCents", p.currency, p.provider, p.destination, p.status,
            p.reference, p.admin_note as "adminNote", p.created_at as "createdAt", p.processed_at as "processedAt"
     from payouts p
     join users u on u.id = p.user_id
     where $1::text is null or p.status = $1
     order by p.created_at desc
     limit 200`,
    [status ?? null]
  );
  return result.rows;
}

/** Admin confirms the bank transfer actually happened, using the provider's own reference. */
export async function completePayout(payoutId: string, adminId: string, adminReference: string) {
  const result = await pool.query(
    `select id, amount_cents as "amountCents", currency, provider, destination, status from payouts where id = $1 for update`,
    [payoutId]
  );
  const payout = result.rows[0];
  if (!payout) throw notFound("Payout not found");
  if (payout.status !== "pending") throw badRequest("Only pending payouts can be completed");

  const provider = getPayoutProvider(payout.provider);
  const outcome = await provider.payout({
    payoutId: payout.id,
    amountCents: Number(payout.amountCents),
    currency: payout.currency,
    destination: payout.destination,
    adminReference
  });

  const updated = await pool.query(
    `update payouts
     set status = 'paid', reference = $2, processed_by = $3, processed_at = now(), updated_at = now()
     where id = $1
     returning id, user_id as "userId", amount_cents as "amountCents", currency, provider, destination, status,
               reference, processed_at as "processedAt"`,
    [payoutId, outcome.reference, adminId]
  );
  return updated.rows[0];
}

/** Admin can't fulfil the payout (bad destination, etc.) - refund the wallet balance back. */
export async function rejectPayout(payoutId: string, adminId: string, reason: string) {
  return inSerializableTx(async (client) => {
    const result = await client.query(
      `select id, user_id as "userId", transaction_id as "transactionId", amount_cents as "amountCents", currency, status
       from payouts where id = $1 for update`,
      [payoutId]
    );
    const payout = result.rows[0];
    if (!payout) throw notFound("Payout not found");
    if (payout.status !== "pending") throw badRequest("Only pending payouts can be rejected");

    const walletId = await ensureWallet(client, payout.userId, payout.currency);
    await client.query(
      `update wallets set available_cents = available_cents + $2, updated_at = now() where id = $1`,
      [walletId, payout.amountCents]
    );
    await client.query(
      `insert into transactions(wallet_id, user_id, type, direction, amount_cents, currency, status, metadata)
       values ($1, $2, 'wallet_credit', 'credit', $3, $4, 'posted', $5)`,
      [walletId, payout.userId, payout.amountCents, payout.currency, { kind: "payout_rejected", payoutId, reason }]
    );
    await recordWalletWithdrawalReversalLedger({
      client,
      transactionId: payout.transactionId,
      userId: payout.userId,
      amountCents: Number(payout.amountCents),
      currency: payout.currency
    });

    const updated = await client.query(
      `update payouts
       set status = 'rejected', admin_note = $2, processed_by = $3, processed_at = now(), updated_at = now()
       where id = $1
       returning id, user_id as "userId", amount_cents as "amountCents", currency, status, admin_note as "adminNote"`,
      [payoutId, reason, adminId]
    );
    await cacheDel(`user:${payout.userId}:wallet`);
    return updated.rows[0];
  });
}
