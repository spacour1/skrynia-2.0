import { Router } from "express";
import express from "express";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { asyncHandler, badRequest, forbidden, notFound } from "../../common/errors.js";
import { authenticate } from "../../common/middleware/auth.js";
import { env } from "../../config/env.js";
import type { AuthedRequest } from "../../common/types.js";
import { lockEscrow } from "../orders/ledger.service.js";
import { recordOrderEvent } from "../orders/order-events.service.js";
import { notifyOrderEvent } from "../chat/ws.service.js";
import { createNotification } from "../notifications/notifications.service.js";
import { paymentAttemptsTotal } from "../../common/metrics.js";
import { logger } from "../../common/logger.js";
import { moneyToCents } from "../../common/validation.js";
import { createWalletTopup, completeWalletTopup } from "../users/wallet.service.js";
import { buildLiqpayCheckout, decodeLiqpayCallback, isLiqpaySuccessStatus, verifyLiqpaySignature } from "./liqpay.service.js";
import { createMonobankInvoice, getMonobankInvoiceStatus, isMonobankSuccessStatus } from "./monobank.service.js";
import { buildWayforpayAck, createWayforpayInvoice, getWayforpayStatus, isWayforpaySuccessStatus } from "./wayforpay.service.js";

const router = Router();

const paySchema = z.object({
  provider: z.enum(["mock", "stripe", "liqpay", "fondy", "monobank"]).default("mock")
});

const walletTopupSchema = z.object({
  amount: z.string()
});

export async function announceOrderPaid(order: { id: string; buyer_id: string; seller_id: string; payment_provider: string }, actorId: string) {
  notifyOrderEvent(order.seller_id, { type: "order_paid", orderId: order.id });
  notifyOrderEvent(order.buyer_id, { type: "order_paid", orderId: order.id });
  await createNotification({
    userId: order.seller_id,
    type: "order_paid",
    title: "Заказ оплачен",
    body: "Покупатель оплатил заказ. Можно начинать выполнение.",
    orderId: order.id
  });
  await createNotification({
    userId: order.buyer_id,
    type: "order_paid",
    title: "Оплата в escrow",
    body: "Средства зарезервированы до подтверждения доставки.",
    orderId: order.id
  });
  await recordOrderEvent({
    orderId: order.id,
    actorId,
    type: "paid",
    title: "Заказ оплачен",
    body: "Оплата зарезервирована в escrow.",
    metadata: { provider: order.payment_provider }
  });
}

router.post(
  "/orders/:orderId/pay",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const orderId = z.string().uuid().parse(req.params.orderId);
    const input = paySchema.parse(req.body);

    let updated;
    try {
      updated = await lockEscrow(orderId, req.user.id, input.provider);
      paymentAttemptsTotal.labels(input.provider, "captured").inc();
    } catch (error) {
      paymentAttemptsTotal.labels(input.provider, "failed").inc();
      throw error;
    }
    const payment = {
      provider: updated.payment_provider,
      reference: updated.payment_reference,
      status: "captured" as const
    };
    await announceOrderPaid(updated, req.user.id);
    res.json({ order: updated, payment });
  })
);

router.post(
  "/orders/:orderId/liqpay/checkout",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const orderId = z.string().uuid().parse(req.params.orderId);
    const result = await pool.query(
      `select o.id, o.buyer_id, o.amount_cents, o.currency, o.status, p.title as product_title
       from orders o
       join products p on p.id = o.product_id
       where o.id = $1`,
      [orderId]
    );
    const order = result.rows[0];
    if (!order) throw notFound("Order not found");
    if (order.buyer_id !== req.user.id) throw forbidden("Only the buyer can pay this order");
    if (order.status !== "pending") throw badRequest("Only pending orders can be paid");

    const checkout = buildLiqpayCheckout({
      orderId: order.id,
      amountCents: Number(order.amount_cents),
      currency: order.currency,
      description: `SKRYNIA: ${order.product_title}`,
      resultUrl: `${env.FRONTEND_URL}/orders/${order.id}?liqpay=return`
    });
    res.json({ data: checkout.data, signature: checkout.signature, actionUrl: checkout.actionUrl });
  })
);

router.post(
  "/orders/:orderId/monobank/checkout",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const orderId = z.string().uuid().parse(req.params.orderId);
    const result = await pool.query(
      `select o.id, o.buyer_id, o.amount_cents, o.currency, o.status, p.title as product_title
       from orders o
       join products p on p.id = o.product_id
       where o.id = $1`,
      [orderId]
    );
    const order = result.rows[0];
    if (!order) throw notFound("Order not found");
    if (order.buyer_id !== req.user.id) throw forbidden("Only the buyer can pay this order");
    if (order.status !== "pending") throw badRequest("Only pending orders can be paid");

    const invoice = await createMonobankInvoice({
      reference: order.id,
      amountCents: Number(order.amount_cents),
      currency: order.currency,
      description: `SKRYNIA: ${order.product_title}`,
      redirectUrl: `${env.FRONTEND_URL}/orders/${order.id}?monobank=return`
    });
    res.json({ pageUrl: invoice.pageUrl, invoiceId: invoice.invoiceId });
  })
);

router.post(
  "/orders/:orderId/wayforpay/checkout",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const orderId = z.string().uuid().parse(req.params.orderId);
    const result = await pool.query(
      `select o.id, o.buyer_id, o.amount_cents, o.currency, o.status, p.title as product_title
       from orders o
       join products p on p.id = o.product_id
       where o.id = $1`,
      [orderId]
    );
    const order = result.rows[0];
    if (!order) throw notFound("Order not found");
    if (order.buyer_id !== req.user.id) throw forbidden("Only the buyer can pay this order");
    if (order.status !== "pending") throw badRequest("Only pending orders can be paid");

    const invoice = await createWayforpayInvoice({
      orderReference: order.id,
      amountCents: Number(order.amount_cents),
      currency: order.currency,
      productName: `SKRYNIA: ${order.product_title}`
    });
    res.json({ invoiceUrl: invoice.invoiceUrl });
  })
);

/**
 * Read-only: just hands the buyer the bank details and an order-specific comment to put
 * in the transfer. Doesn't touch order state — only an admin confirming the transfer
 * from the admin panel ever triggers lockEscrow for this provider.
 */
router.get(
  "/orders/:orderId/manual/details",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const orderId = z.string().uuid().parse(req.params.orderId);
    const result = await pool.query(
      `select o.id, o.buyer_id, o.amount_cents, o.currency, p.title as product_title
       from orders o
       join products p on p.id = o.product_id
       where o.id = $1`,
      [orderId]
    );
    const order = result.rows[0];
    if (!order) throw notFound("Order not found");
    if (order.buyer_id !== req.user.id) throw forbidden("Only the buyer can view this order's payment details");

    if (!env.MANUAL_PAYMENT_CARD_NUMBER || !env.MANUAL_PAYMENT_RECEIVER_NAME) {
      throw badRequest("Manual transfer is not configured on this server");
    }

    res.json({
      cardNumber: env.MANUAL_PAYMENT_CARD_NUMBER,
      receiverName: env.MANUAL_PAYMENT_RECEIVER_NAME,
      bank: env.MANUAL_PAYMENT_BANK ?? null,
      amountCents: Number(order.amount_cents),
      currency: order.currency,
      comment: `SKRYNIA ${order.id.slice(0, 8)}`
    });
  })
);

router.post(
  "/wallet/liqpay/checkout",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const input = walletTopupSchema.parse(req.body);
    const amountCents = moneyToCents(input.amount);
    if (amountCents < 100) throw badRequest("Minimum top-up amount is 1.00");

    const topup = await createWalletTopup(req.user.id, amountCents, "UAH");
    const checkout = buildLiqpayCheckout({
      orderId: topup.id,
      amountCents,
      currency: "UAH",
      description: "SKRYNIA: пополнение баланса",
      resultUrl: `${env.FRONTEND_URL}/wallet?liqpay=return`
    });
    res.json({ data: checkout.data, signature: checkout.signature, actionUrl: checkout.actionUrl });
  })
);

router.post(
  "/wallet/monobank/checkout",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const input = walletTopupSchema.parse(req.body);
    const amountCents = moneyToCents(input.amount);
    if (amountCents < 100) throw badRequest("Minimum top-up amount is 1.00");

    const topup = await createWalletTopup(req.user.id, amountCents, "UAH");
    const invoice = await createMonobankInvoice({
      reference: topup.id,
      amountCents,
      currency: "UAH",
      description: "SKRYNIA: пополнение баланса",
      redirectUrl: `${env.FRONTEND_URL}/wallet?monobank=return`
    });
    res.json({ pageUrl: invoice.pageUrl, invoiceId: invoice.invoiceId });
  })
);

router.post(
  "/wallet/wayforpay/checkout",
  authenticate,
  asyncHandler(async (req: AuthedRequest, res) => {
    const input = walletTopupSchema.parse(req.body);
    const amountCents = moneyToCents(input.amount);
    if (amountCents < 100) throw badRequest("Minimum top-up amount is 1.00");

    const topup = await createWalletTopup(req.user.id, amountCents, "UAH");
    const invoice = await createWayforpayInvoice({
      orderReference: topup.id,
      amountCents,
      currency: "UAH",
      productName: "SKRYNIA: пополнение баланса"
    });
    res.json({ invoiceUrl: invoice.invoiceUrl });
  })
);

/**
 * LiqPay's server_url webhook. Called server-to-server (no auth, no CSRF token, and
 * potentially more than once for the same payment) so every step here must be safe to
 * repeat: verify the signature, then let lockEscrow's own `status = 'pending'` check
 * make a second delivery a no-op instead of a double capture.
 */
router.post(
  "/liqpay/callback",
  express.urlencoded({ extended: false }),
  asyncHandler(async (req, res) => {
    const body = z.object({ data: z.string(), signature: z.string() }).safeParse(req.body);
    if (!body.success) return res.status(400).send("Malformed callback");

    if (!verifyLiqpaySignature(body.data.data, body.data.signature)) {
      return res.status(400).send("Invalid signature");
    }

    const callback = decodeLiqpayCallback(body.data.data);
    if (!isLiqpaySuccessStatus(callback.status)) {
      // Not a final success (pending 3-D Secure, failure, etc.) - nothing to capture yet.
      return res.status(200).send("ok");
    }

    const reference = String(callback.payment_id ?? callback.order_id);

    const orderRow = await pool.query(`select id, buyer_id from orders where id = $1`, [callback.order_id]);
    const order = orderRow.rows[0];
    if (order) {
      try {
        const updated = await lockEscrow(order.id, order.buyer_id, "liqpay", reference);
        paymentAttemptsTotal.labels("liqpay", "captured").inc();
        await announceOrderPaid(updated, order.buyer_id);
      } catch (error) {
        // Order is no longer pending (already captured by an earlier delivery of this
        // same webhook, or otherwise no longer payable) - acknowledge so LiqPay stops retrying.
        paymentAttemptsTotal.labels("liqpay", "failed").inc();
        logger.warn({ orderId: order.id, error }, "liqpay_callback_capture_skipped");
      }
      return res.status(200).send("ok");
    }

    const topupRow = await pool.query(`select id from wallet_topups where id = $1`, [callback.order_id]);
    if (topupRow.rows[0]) {
      try {
        await completeWalletTopup(callback.order_id, "liqpay", reference);
        paymentAttemptsTotal.labels("liqpay", "captured").inc();
      } catch (error) {
        paymentAttemptsTotal.labels("liqpay", "failed").inc();
        logger.warn({ topupId: callback.order_id, error }, "liqpay_callback_topup_skipped");
      }
      return res.status(200).send("ok");
    }

    res.status(200).send("ok");
  })
);

/**
 * Monobank's webHookUrl ping. We don't verify Monobank's ECDSA body signature here —
 * instead we treat the webhook purely as a "go check now" signal and re-fetch the
 * invoice status ourselves with our merchant token, which is the data we actually act
 * on. Like the LiqPay webhook, this can be delivered more than once for the same
 * invoice, so every step must stay safe to repeat.
 */
router.post(
  "/monobank/callback",
  asyncHandler(async (req, res) => {
    const body = z.object({ invoiceId: z.string() }).safeParse(req.body);
    if (!body.success) return res.status(400).send("Malformed callback");

    const invoice = await getMonobankInvoiceStatus(body.data.invoiceId);
    if (!isMonobankSuccessStatus(invoice.status) || !invoice.reference) {
      return res.status(200).send("ok");
    }

    const orderRow = await pool.query(`select id, buyer_id from orders where id = $1`, [invoice.reference]);
    const order = orderRow.rows[0];
    if (order) {
      try {
        const updated = await lockEscrow(order.id, order.buyer_id, "monobank", invoice.invoiceId);
        paymentAttemptsTotal.labels("monobank", "captured").inc();
        await announceOrderPaid(updated, order.buyer_id);
      } catch (error) {
        paymentAttemptsTotal.labels("monobank", "failed").inc();
        logger.warn({ orderId: order.id, error }, "monobank_callback_capture_skipped");
      }
      return res.status(200).send("ok");
    }

    const topupRow = await pool.query(`select id from wallet_topups where id = $1`, [invoice.reference]);
    if (topupRow.rows[0]) {
      try {
        await completeWalletTopup(invoice.reference, "monobank", invoice.invoiceId);
        paymentAttemptsTotal.labels("monobank", "captured").inc();
      } catch (error) {
        paymentAttemptsTotal.labels("monobank", "failed").inc();
        logger.warn({ topupId: invoice.reference, error }, "monobank_callback_topup_skipped");
      }
      return res.status(200).send("ok");
    }

    res.status(200).send("ok");
  })
);

/**
 * WayForPay's serviceUrl webhook. As with the Monobank callback, we don't trust the
 * body's merchantSignature — we only use orderReference to know what to re-check via
 * getWayforpayStatus, signed with our own merchant credentials. WayForPay also requires
 * a specific signed acknowledgment back or it will keep retrying.
 */
router.post(
  "/wayforpay/callback",
  asyncHandler(async (req, res) => {
    const body = z.object({ orderReference: z.string() }).safeParse(req.body);
    if (!body.success) return res.status(400).send("Malformed callback");

    const orderReference = body.data.orderReference;
    const status = await getWayforpayStatus(orderReference);

    if (isWayforpaySuccessStatus(status.transactionStatus)) {
      const orderRow = await pool.query(`select id, buyer_id from orders where id = $1`, [orderReference]);
      const order = orderRow.rows[0];
      if (order) {
        try {
          const updated = await lockEscrow(order.id, order.buyer_id, "wayforpay", orderReference);
          paymentAttemptsTotal.labels("wayforpay", "captured").inc();
          await announceOrderPaid(updated, order.buyer_id);
        } catch (error) {
          paymentAttemptsTotal.labels("wayforpay", "failed").inc();
          logger.warn({ orderId: order.id, error }, "wayforpay_callback_capture_skipped");
        }
      } else {
        const topupRow = await pool.query(`select id from wallet_topups where id = $1`, [orderReference]);
        if (topupRow.rows[0]) {
          try {
            await completeWalletTopup(orderReference, "wayforpay", orderReference);
            paymentAttemptsTotal.labels("wayforpay", "captured").inc();
          } catch (error) {
            paymentAttemptsTotal.labels("wayforpay", "failed").inc();
            logger.warn({ topupId: orderReference, error }, "wayforpay_callback_topup_skipped");
          }
        }
      }
    }

    res.json(buildWayforpayAck(orderReference));
  })
);

export default router;
