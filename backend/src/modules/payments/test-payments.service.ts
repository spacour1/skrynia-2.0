import { badRequest, forbidden, notFound } from "../../common/errors.js";
import { inTx, pool } from "../../db/pool.js";
import { lockEscrow } from "../orders/ledger.service.js";
import {
  selectOrderForUpdate,
  transitionOrder
} from "../orders/order-transition.service.js";

async function loadOwnOrder(orderId: string, buyerId: string) {
  const result = await pool.query(`select * from orders where id = $1`, [orderId]);
  const order = result.rows[0];
  if (!order) throw notFound("Order not found");
  if (order.buyer_id !== buyerId) throw forbidden("Only the buyer can simulate payment for this order");
  return order;
}

export async function simulateTestPaymentSuccess(orderId: string, buyerId: string) {
  await loadOwnOrder(orderId, buyerId);
  const updated = await lockEscrow(orderId, buyerId, "mock", undefined, {
    actor: { kind: "service", id: buyerId, role: "test_payment" }
  });
  return updated;
}

export async function simulateTestPaymentFailure(orderId: string, buyerId: string) {
  const updated = await inTx(async (client) => {
    const order = await selectOrderForUpdate(client, orderId);
    if (order.buyer_id !== buyerId) {
      throw forbidden("Only the buyer can simulate payment for this order");
    }
    if (order.status !== "pending") {
      throw badRequest("Only a pending order's payment can be simulated as failed");
    }

    return transitionOrder(client, {
      orderId,
      to: "canceled",
      actor: { kind: "service", id: buyerId, role: "test_payment" },
      reason: "test_payment_failed",
      expectedFrom: ["pending"]
    });
  });
  return updated;
}

export async function simulateTestPaymentWaitAccept(orderId: string, buyerId: string) {
  const order = await loadOwnOrder(orderId, buyerId);
  if (order.status !== "pending") throw badRequest("Order is no longer awaiting payment confirmation");
  return order;
}
