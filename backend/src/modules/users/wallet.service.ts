import { pool } from "../../db/pool.js";
import { inSerializableTx } from "../../db/pool.js";
import { badRequest, notFound } from "../../common/errors.js";
import { cacheDel } from "../../common/redis.js";
import { ensureWallet } from "../orders/ledger.service.js";
import { recordWalletTopupLedger, recordWalletWithdrawalLedger } from "../orders/accounting.service.js";

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
 * Simulated payout: this MVP has no real LiqPay payout/P2P integration (that needs
 * separate merchant access), so a withdrawal just reserves the balance immediately and
 * records it as a pending wallet_debit, the same way other simulated provider flows work.
 */
export async function requestWithdrawal(userId: string, amountCents: number, currency: string) {
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
       returning id, type, direction, amount_cents as "amountCents", currency, status, created_at as "createdAt"`,
      [walletId, userId, amountCents, currency, { simulated: true }]
    );
    await recordWalletWithdrawalLedger({
      client,
      transactionId: tx.rows[0].id,
      userId,
      amountCents,
      currency
    });
    await cacheDel(`user:${userId}:wallet`);
    return tx.rows[0];
  });
}
