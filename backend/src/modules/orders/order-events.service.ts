import { pool } from "../../db/pool.js";

export async function recordOrderEvent(input: {
  orderId: string;
  actorId?: string | null;
  type: string;
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
}) {
  const result = await pool.query(
    `insert into order_events(order_id, actor_id, type, title, body, metadata)
     values ($1, $2, $3, $4, $5, $6)
     returning id, order_id as "orderId", actor_id as "actorId", type, title, body, metadata, created_at as "createdAt"`,
    [input.orderId, input.actorId ?? null, input.type, input.title, input.body ?? null, JSON.stringify(input.metadata ?? {})]
  );
  return result.rows[0];
}

