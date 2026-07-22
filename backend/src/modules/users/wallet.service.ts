import { pool } from "../../db/pool.js";
import { inSerializableTx } from "../../db/pool.js";
import { badRequest, notFound } from "../../common/errors.js";
import { cacheDel } from "../../common/redis.js";
import { centsToDecimalString } from "../../common/validation.js";
import { ensureWallet } from "../orders/ledger.service.js";
import {
  recordManualAdjustmentLedger,
  recordWalletTopupLedger,
  recordWalletWithdrawalLedger,
  recordWalletWithdrawalReversalLedger
} from "../orders/accounting.service.js";
import { nanoid } from "nanoid";
import type { PayoutDestination } from "../payments/payout.providers.js";
import { getPayoutProvider } from "../payments/payout.providers.js";
import { createNotification, notifyAdmins } from "../notifications/notifications.service.js";
import {
  absoluteMoneyCents,
  addMoneyCents,
  bigintToMoneyCents,
  MoneyRangeError,
  parseMoneyCents,
  subtractMoneyCents,
  type MoneyCents
} from "../../domain/money.js";

function checkedWalletAddition(currentCents: MoneyCents, addedCents: MoneyCents) {
  try {
    return addMoneyCents(currentCents, addedCents);
  } catch (error) {
    if (error instanceof MoneyRangeError) {
      throw badRequest("Wallet balance exceeds the supported money range");
    }
    throw error;
  }
}

function checkedWalletSubtraction(currentCents: MoneyCents, subtractedCents: MoneyCents) {
  try {
    return subtractMoneyCents(currentCents, subtractedCents);
  } catch (error) {
    if (error instanceof MoneyRangeError) {
      throw badRequest("Wallet balance exceeds the supported money range");
    }
    throw error;
  }
}

export async function createWalletTopup(userId: string, amountCents: MoneyCents, currency: string) {
  const canonicalAmount = bigintToMoneyCents(amountCents);
  const result = await pool.query(
    `insert into wallet_topups(user_id, amount_cents, currency)
     values ($1, $2, $3)
     returning id, user_id as "userId", amount_cents as "amountCents", currency, status`,
    [userId, canonicalAmount, currency]
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
    const wallet = await client.query<{ available_cents: MoneyCents }>(
      `select available_cents from wallets where id = $1 for update`,
      [walletId]
    );
    const amountCents = bigintToMoneyCents(topup.amount_cents);
    const nextAvailableCents = checkedWalletAddition(
      wallet.rows[0].available_cents,
      amountCents
    );
    await client.query(
      `update wallets set available_cents = $2, updated_at = now() where id = $1`,
      [walletId, nextAvailableCents]
    );
    await client.query(
      `insert into transactions(wallet_id, user_id, type, direction, amount_cents, currency, metadata)
       values ($1, $2, 'wallet_credit', 'credit', $3, $4, $5)`,
      [walletId, topup.user_id, topup.amount_cents, topup.currency, { provider, reference }]
    );
    await recordWalletTopupLedger({
      client,
      userId: topup.user_id,
      amountCents,
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
  amountCents: MoneyCents,
  currency: string,
  destination: PayoutDestination
) {
  const canonicalAmount = bigintToMoneyCents(amountCents);
  if (parseMoneyCents(canonicalAmount) <= 0n) {
    throw badRequest("Withdrawal amount must be positive");
  }
  const payout = await inSerializableTx(async (client) => {
    const walletId = await ensureWallet(client, userId, currency);
    const walletResult = await client.query<{ available_cents: MoneyCents }>(
      `select available_cents from wallets where id = $1 for update`,
      [walletId]
    );
    const available = parseMoneyCents(walletResult.rows[0].available_cents);
    if (available < parseMoneyCents(canonicalAmount)) throw badRequest("Insufficient balance");
    const nextAvailableCents = checkedWalletSubtraction(
      walletResult.rows[0].available_cents,
      canonicalAmount
    );

    await client.query(
      `update wallets set available_cents = $2, updated_at = now() where id = $1`,
      [walletId, nextAvailableCents]
    );
    const tx = await client.query(
      `insert into transactions(wallet_id, user_id, type, direction, amount_cents, currency, status, metadata)
       values ($1, $2, 'wallet_debit', 'debit', $3, $4, 'pending', $5)
       returning id`,
      [walletId, userId, canonicalAmount, currency, { destination }]
    );
    await recordWalletWithdrawalLedger({
      client,
      transactionId: tx.rows[0].id,
      userId,
      amountCents: canonicalAmount,
      currency
    });
    const payout = await client.query(
      `insert into payouts(user_id, transaction_id, amount_cents, currency, provider, destination, status)
       values ($1, $2, $3, $4, 'manual', $5, 'pending')
       returning id, user_id as "userId", amount_cents as "amountCents", currency, provider, destination, status,
                 created_at as "createdAt"`,
      [userId, tx.rows[0].id, canonicalAmount, currency, destination]
    );
    await cacheDel(`user:${userId}:wallet`);
    return payout.rows[0];
  });

  const amount = centsToDecimalString(canonicalAmount);
  await createNotification({
    userId,
    type: "payout_requested",
    templateKey: "notifications.payoutRequested",
    params: { amount, currency }
  });
  await notifyAdmins({
    type: "payout_pending_admin",
    templateKey: "notifications.payoutPendingAdmin",
    params: { amount, currency }
  });
  return payout;
}

/**
 * Admin-only manual correction to a user's wallet balance (e.g. fixing a support case the
 * automated flows couldn't handle). Always requires a reason, which is recorded both on the
 * transaction and in the ledger entry's metadata so it shows up in every audit trail.
 */
export async function postManualAdjustment(input: {
  userId: string;
  amountCents: MoneyCents;
  currency: string;
  reason: string;
  adminId: string;
}) {
  const signedAmount = parseMoneyCents(input.amountCents);
  if (signedAmount === 0n) throw badRequest("Adjustment amount cannot be zero");
  let magnitude: MoneyCents;
  try {
    magnitude = absoluteMoneyCents(input.amountCents);
  } catch (error) {
    if (error instanceof MoneyRangeError) {
      throw badRequest("Adjustment amount magnitude exceeds the supported money range");
    }
    throw error;
  }
  return inSerializableTx(async (client) => {
    const walletId = await ensureWallet(client, input.userId, input.currency);
    const walletResult = await client.query<{ available_cents: MoneyCents }>(
      `select available_cents from wallets where id = $1 for update`,
      [walletId]
    );
    if (signedAmount < 0n) {
      if (parseMoneyCents(walletResult.rows[0].available_cents) < parseMoneyCents(magnitude)) {
        throw badRequest("Insufficient balance for a negative adjustment");
      }
    }
    const nextAvailableCents = checkedWalletAddition(
      walletResult.rows[0].available_cents,
      input.amountCents
    );

    await client.query(
      `update wallets set available_cents = $2, updated_at = now() where id = $1`,
      [walletId, nextAvailableCents]
    );
    const adjustmentId = nanoid();
    const tx = await client.query(
      `insert into transactions(wallet_id, user_id, type, direction, amount_cents, currency, status, metadata)
       values ($1, $2, 'manual_adjustment', $3, $4, $5, 'posted', $6)
       returning id`,
      [
        walletId,
        input.userId,
        signedAmount >= 0n ? "credit" : "debit",
        magnitude,
        input.currency,
        { adminId: input.adminId, reason: input.reason }
      ]
    );
    await recordManualAdjustmentLedger({
      client,
      adjustmentId,
      userId: input.userId,
      amountCents: input.amountCents,
      currency: input.currency,
      adminId: input.adminId,
      reason: input.reason
    });
    await cacheDel(`user:${input.userId}:wallet`);
    return { transactionId: tx.rows[0].id, walletId, amountCents: input.amountCents, currency: input.currency };
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
    amountCents: bigintToMoneyCents(payout.amountCents),
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
  const paid = updated.rows[0];
  await createNotification({
    userId: paid.userId,
    type: "payout_approved",
    templateKey: "notifications.payoutApproved",
    params: { amount: centsToDecimalString(paid.amountCents), currency: paid.currency }
  });
  return paid;
}

/** Admin can't fulfil the payout (bad destination, etc.) - refund the wallet balance back. */
export async function rejectPayout(payoutId: string, adminId: string, reason: string) {
  const rejected = await inSerializableTx(async (client) => {
    const result = await client.query(
      `select id, user_id as "userId", transaction_id as "transactionId", amount_cents as "amountCents", currency, status
       from payouts where id = $1 for update`,
      [payoutId]
    );
    const payout = result.rows[0];
    if (!payout) throw notFound("Payout not found");
    if (payout.status !== "pending") throw badRequest("Only pending payouts can be rejected");

    const walletId = await ensureWallet(client, payout.userId, payout.currency);
    const wallet = await client.query<{ available_cents: MoneyCents }>(
      `select available_cents from wallets where id = $1 for update`,
      [walletId]
    );
    const payoutAmountCents = bigintToMoneyCents(payout.amountCents);
    const nextAvailableCents = checkedWalletAddition(
      wallet.rows[0].available_cents,
      payoutAmountCents
    );
    await client.query(
      `update wallets set available_cents = $2, updated_at = now() where id = $1`,
      [walletId, nextAvailableCents]
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
      amountCents: payoutAmountCents,
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

  await createNotification({
    userId: rejected.userId,
    type: "payout_rejected",
    templateKey: "notifications.payoutRejected",
    params: {
      amount: centsToDecimalString(rejected.amountCents),
      currency: rejected.currency,
      reason
    }
  });
  return rejected;
}
