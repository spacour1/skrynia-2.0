import { badRequest, forbidden, notFound } from "../../common/errors.js";
import { pool } from "../../db/pool.js";
import { lockEscrow } from "../orders/ledger.service.js";
import { recordOrderEvent } from "../orders/order-events.service.js";
import { notifyOrderEvent } from "../chat/ws.service.js";
import { announceOrderPaid } from "./payments.routes.js";

async function loadOwnOrder(orderId: string, buyerId: string) {
  const result = await pool.query(`select * from orders where id = $1`, [orderId]);
  const order = result.rows[0];
  if (!order) throw notFound("Order not found");
  if (order.buyer_id !== buyerId) throw forbidden("Only the buyer can simulate payment for this order");
  return order;
}

export async function simulateTestPaymentSuccess(orderId: string, buyerId: string) {
  await loadOwnOrder(orderId, buyerId);
  const updated = await lockEscrow(orderId, buyerId, "mock");
  await announceOrderPaid(updated, buyerId);
  return updated;
}

export async function simulateTestPaymentFailure(orderId: string, buyerId: string) {
  const order = await loadOwnOrder(orderId, buyerId);
  if (order.status !== "pending") throw badRequest("Only a pending order's payment can be simulated as failed");

  const updated = await pool.query(`update orders set status = 'canceled', updated_at = now() where id = $1 returning *`, [
    orderId
  ]);
  await recordOrderEvent({
    orderId,
    actorId: buyerId,
    type: "canceled",
    title: "Оплата не прошла",
    body: "Тестовый платеж завершился ошибкой."
  });
  notifyOrderEvent(order.seller_id, { type: "order_canceled", orderId });
  return updated.rows[0];
}

export async function simulateTestPaymentWaitAccept(orderId: string, buyerId: string) {
  const order = await loadOwnOrder(orderId, buyerId);
  if (order.status !== "pending") throw badRequest("Order is no longer awaiting payment confirmation");
  return order;
}
