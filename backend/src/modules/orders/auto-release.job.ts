import { pool } from "../../db/pool.js";
import { releaseEscrow } from "./ledger.service.js";
import { recordOrderEvent } from "./order-events.service.js";
import { createOrderSystemMessage } from "../chat/system-messages.service.js";

let running = false;

export async function runAutoReleaseSweep() {
  if (running) return;
  running = true;
  try {
    const due = await pool.query<{ id: string; buyer_id: string; seller_id: string }>(
      `select id, buyer_id, seller_id
       from orders
       where status = 'delivered'
         and auto_release_at is not null
         and auto_release_at <= now()
       order by auto_release_at asc
       limit 25`
    );

    for (const order of due.rows) {
      try {
        await releaseEscrow(order.id, {
          source: "auto",
          afterUpdate: async (client) => {
            await recordOrderEvent(
              {
                orderId: order.id,
                type: "auto_released",
                templateKey: "orderEvents.autoReleased"
              },
              client
            );
            const message = await createOrderSystemMessage(
              {
                orderId: order.id,
                type: "escrow_released",
                bodyKey: "system.fundsReleased"
              },
              client
            );
            return { systemMessageIds: message ? [message.id] : [] };
          }
        });
      } catch (error) {
        console.error("Auto release failed", order.id, error);
      }
    }
  } finally {
    running = false;
  }
}

export function startAutoReleaseJob() {
  setInterval(() => {
    runAutoReleaseSweep().catch((error) => console.error("Auto release sweep failed", error));
  }, 60_000).unref();
}
