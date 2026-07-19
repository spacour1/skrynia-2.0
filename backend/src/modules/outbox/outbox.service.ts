import type pg from "pg";

export const domainEventTypes = [
  "order.created",
  "order.started",
  "order.delivered",
  "order.completed",
  "review.created",
  "dispute.opened",
  "dispute.resolved",
  "message.created",
  "product.blocked",
  "user.banned",
  "user.warned",
  "user.muted"
] as const;

export type DomainEventType = (typeof domainEventTypes)[number];

export type DomainOutboxStatus = "pending" | "processing" | "processed" | "failed";

export type DomainOutboxEvent = {
  id: string;
  eventKey: string;
  eventType: DomainEventType;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  status: DomainOutboxStatus;
  attempts: number;
  availableAt: Date;
  lockedAt: Date | null;
  lockedBy: string | null;
  processedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type EnqueueDomainEventInput = {
  eventKey: string;
  eventType: DomainEventType;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
};

type OutboxRow = {
  id: string;
  eventKey: string;
  eventType: DomainEventType;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  status: DomainOutboxStatus;
  attempts: number;
  availableAt: Date;
  lockedAt: Date | null;
  lockedBy: string | null;
  processedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export const outboxReturningColumns = `
  id,
  event_key as "eventKey",
  event_type as "eventType",
  aggregate_type as "aggregateType",
  aggregate_id as "aggregateId",
  payload,
  status,
  attempts,
  available_at as "availableAt",
  locked_at as "lockedAt",
  locked_by as "lockedBy",
  processed_at as "processedAt",
  last_error as "lastError",
  created_at as "createdAt",
  updated_at as "updatedAt"
`;

/**
 * Must be called with the transaction client that is mutating the aggregate. Accepting
 * PoolClient rather than the wider DbClient type prevents accidental pool-level writes.
 */
export async function enqueueDomainEvent(
  client: pg.PoolClient,
  input: EnqueueDomainEventInput
): Promise<DomainOutboxEvent> {
  const inserted = await client.query<OutboxRow>(
    `insert into domain_outbox(event_key, event_type, aggregate_type, aggregate_id, payload)
     values ($1, $2, $3, $4, $5)
     on conflict (event_key) do nothing
     returning ${outboxReturningColumns}`,
    [
      input.eventKey,
      input.eventType,
      input.aggregateType,
      input.aggregateId,
      JSON.stringify(input.payload)
    ]
  );
  if (inserted.rows[0]) return inserted.rows[0];

  const existing = await client.query<OutboxRow>(
    `select ${outboxReturningColumns}
     from domain_outbox
     where event_key = $1`,
    [input.eventKey]
  );
  if (!existing.rows[0]) {
    throw new Error(`Outbox event ${input.eventKey} conflicted but could not be read`);
  }
  return existing.rows[0];
}
