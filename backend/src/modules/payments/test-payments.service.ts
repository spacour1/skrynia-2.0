import { badRequest, forbidden, notFound } from "../../common/errors.js";
import { inTx, pool } from "../../db/pool.js";
import { lockEscrow } from "../orders/ledger.service.js";
import { recordOrderEvent } from "../orders/order-events.service.js";
import { enqueueDomainEvent } from "../outbox/outbox.service.js";

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
  return updated;
}

export async function simulateTestPaymentFailure(orderId: string, buyerId: string) {
  const updated = await inTx(async (client) => {
    const selected = await client.query(`select * from orders where id = $1 for update`, [orderId]);
    const order = selected.rows[0];
    if (!order) throw notFound("Order not found");
    if (order.buyer_id !== buyerId) {
      throw forbidden("Only the buyer can simulate payment for this order");
    }
    if (order.status !== "pending") {
      throw badRequest("Only a pending order's payment can be simulated as failed");
    }

    const changed = await client.query(
      `update orders
       set status = 'canceled', updated_at = now()
       where id = $1 and status = 'pending'
       returning *`,
      [orderId]
    );
    if (!changed.rows[0]) {
      throw badRequest("Only a pending order's payment can be simulated as failed");
    }
    await recordOrderEvent(
      {
        orderId,
        actorId: buyerId,
        type: "canceled",
        templateKey: "orderEvents.paymentFailed"
      },
      client
    );
    await enqueueDomainEvent(client, {
      eventKey: `order.canceled:${orderId}`,
      eventType: "order.canceled",
      aggregateType: "order",
      aggregateId: orderId,
      payload: {
        orderId,
        buyerId: order.buyer_id,
        sellerId: order.seller_id,
        productId: order.product_id,
        systemMessageIds: []
      }
    });
    return changed.rows[0];
  });
  return updated;
}

export async function simulateTestPaymentWaitAccept(orderId: string, buyerId: string) {
  const order = await loadOwnOrder(orderId, buyerId);
  if (order.status !== "pending") throw badRequest("Order is no longer awaiting payment confirmation");
  return order;
}
