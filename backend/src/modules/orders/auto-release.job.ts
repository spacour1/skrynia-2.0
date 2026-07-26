import { pool } from "../../db/pool.js";
import { releaseEscrow } from "./ledger.service.js";

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
          source: "auto"
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
