import type pg from "pg";
import { env } from "../../config/env.js";
import type { OrderStatus } from "../../domain/enums.js";
import type { MoneyCents } from "../../domain/money.js";
import { badRequest, forbidden, notFound } from "../../common/errors.js";
import { enqueueDomainEvent, type EnqueueDomainEventInput } from "../outbox/outbox.service.js";
import { recordOrderEvent } from "./order-events.service.js";
import { assertOrderTransition } from "./order-transitions.js";

export type OrderTransitionUserRole = "buyer" | "seller" | "participant" | "admin";
export type OrderTransitionServiceRole =
  | "payment_provider"
  | "auto_release"
  | "test_payment"
  | "system";

export type OrderTransitionActor =
  | {
      kind: "user";
      id: string;
      role: OrderTransitionUserRole;
    }
  | {
      kind: "service";
      id: string;
      role: OrderTransitionServiceRole;
    };

export type OrderTransitionReason =
  | "payment_captured"
  | "test_payment_failed"
  | "seller_started"
  | "seller_delivered"
  | "buyer_confirmed"
  | "auto_released"
  | "dispute_opened"
  | "dispute_released"
  | "dispute_refunded"
  | "service_released"
  | "service_refunded";

export type OrderRow = {
  id: string;
  buyer_id: string;
  seller_id: string;
  product_id: string;
  quantity: number;
  amount_cents: MoneyCents;
  fee_cents: MoneyCents;
  currency: string;
  status: OrderStatus;
  payment_provider: string | null;
  payment_reference: string | null;
  delivery_note: string | null;
  auto_release_at: Date | null;
  paid_at: Date | null;
  delivered_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type TransitionOrderInput = {
  orderId: string;
  to: OrderStatus;
  actor: OrderTransitionActor;
  reason: OrderTransitionReason;
  expectedFrom?: readonly OrderStatus[];
  metadata?: Record<string, unknown>;
};

const orderRowColumns = `
  id,
  buyer_id,
  seller_id,
  product_id,
  quantity,
  amount_cents,
  fee_cents,
  currency,
  status,
  payment_provider,
  payment_reference,
  delivery_note,
  auto_release_at,
  paid_at,
  delivered_at,
  completed_at,
  created_at,
  updated_at
`;

export async function selectOrderForUpdate(
  client: pg.PoolClient,
  orderId: string
): Promise<OrderRow> {
  const selected = await client.query<OrderRow>(
    `select ${orderRowColumns}
     from orders
     where id = $1
     for update`,
    [orderId]
  );
  const order = selected.rows[0];
  if (!order) throw notFound("Order not found");
  return order;
}

type ReasonPolicy = {
  readonly to: readonly OrderStatus[];
  readonly roles: readonly (OrderTransitionUserRole | OrderTransitionServiceRole)[];
};

const REASON_POLICIES: Readonly<Record<OrderTransitionReason, ReasonPolicy>> = {
  payment_captured: {
    to: ["paid", "delivered"],
    roles: ["buyer", "admin", "payment_provider", "test_payment"]
  },
  test_payment_failed: { to: ["canceled"], roles: ["test_payment"] },
  seller_started: { to: ["in_progress"], roles: ["seller"] },
  seller_delivered: { to: ["delivered"], roles: ["seller"] },
  buyer_confirmed: { to: ["completed"], roles: ["buyer"] },
  auto_released: { to: ["completed"], roles: ["auto_release"] },
  dispute_opened: { to: ["disputed"], roles: ["participant"] },
  dispute_released: { to: ["completed"], roles: ["admin"] },
  dispute_refunded: { to: ["refunded"], roles: ["admin"] },
  service_released: { to: ["completed"], roles: ["system"] },
  service_refunded: { to: ["refunded"], roles: ["system"] }
};

type OrderEventDescriptor = {
  type: string;
  templateKey: string;
  body?: string;
  params?: Record<string, string | number>;
  metadata?: Record<string, unknown>;
};

function metadataString(
  metadata: Record<string, unknown>,
  key: string,
  required = false
): string | undefined {
  const value = metadata[key];
  if (typeof value === "string" && value.length > 0) return value;
  if (required) throw new Error(`Order transition metadata.${key} is required`);
  return undefined;
}

function systemMessageIds(metadata: Record<string, unknown>): string[] {
  const value = metadata.systemMessageIds;
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error("Order transition metadata.systemMessageIds must be a string array");
  }
  return value as string[];
}

function eventDescriptor(input: TransitionOrderInput): OrderEventDescriptor {
  const metadata = input.metadata ?? {};
  switch (input.reason) {
    case "payment_captured":
      return {
        type: "paid",
        templateKey: "orderEvents.paid",
        metadata: metadataString(metadata, "provider")
          ? { provider: metadataString(metadata, "provider") }
          : undefined
      };
    case "test_payment_failed":
      return { type: "canceled", templateKey: "orderEvents.paymentFailed" };
    case "seller_started":
      return { type: "started", templateKey: "orderEvents.started" };
    case "seller_delivered":
      return { type: "delivered", templateKey: "orderEvents.delivered" };
    case "buyer_confirmed":
    case "service_released":
      return { type: "completed", templateKey: "orderEvents.completed" };
    case "auto_released":
      return { type: "auto_released", templateKey: "orderEvents.autoReleased" };
    case "dispute_opened":
      return {
        type: "disputed",
        templateKey: "orderEvents.disputed",
        body: metadataString(metadata, "disputeReason", true)
      };
    case "dispute_released":
      return { type: "completed", templateKey: "orderEvents.completed" };
    case "dispute_refunded":
    case "service_refunded":
      return { type: "refunded", templateKey: "orderEvents.refunded" };
  }
}

function outboxInput(
  order: OrderRow,
  input: TransitionOrderInput
): EnqueueDomainEventInput {
  const metadata = input.metadata ?? {};
  const basePayload = {
    orderId: order.id,
    buyerId: order.buyer_id,
    sellerId: order.seller_id,
    productId: order.product_id,
    systemMessageIds: systemMessageIds(metadata)
  };

  switch (input.reason) {
    case "payment_captured":
      return {
        eventKey: `order.paid:${order.id}`,
        eventType: "order.paid",
        aggregateType: "order",
        aggregateId: order.id,
        payload: basePayload
      };
    case "test_payment_failed":
      return {
        eventKey: `order.canceled:${order.id}`,
        eventType: "order.canceled",
        aggregateType: "order",
        aggregateId: order.id,
        payload: basePayload
      };
    case "seller_started":
      return {
        eventKey: `order.started:${order.id}`,
        eventType: "order.started",
        aggregateType: "order",
        aggregateId: order.id,
        payload: basePayload
      };
    case "seller_delivered":
      return {
        eventKey: `order.delivered:${order.id}`,
        eventType: "order.delivered",
        aggregateType: "order",
        aggregateId: order.id,
        payload: basePayload
      };
    case "buyer_confirmed":
    case "auto_released":
    case "dispute_released":
    case "service_released":
      return {
        eventKey: `order.completed:${order.id}`,
        eventType: "order.completed",
        aggregateType: "order",
        aggregateId: order.id,
        payload: {
          ...basePayload,
          source:
            input.reason === "buyer_confirmed"
              ? "buyer_confirmed"
              : input.reason === "auto_released"
                ? "auto"
                : input.reason === "dispute_released"
                  ? "dispute"
                  : "service",
          actorId: input.actor.kind === "user" ? input.actor.id : null
        }
      };
    case "dispute_opened": {
      const disputeId = metadataString(metadata, "disputeId", true)!;
      return {
        eventKey: `dispute.opened:${disputeId}`,
        eventType: "dispute.opened",
        aggregateType: "dispute",
        aggregateId: disputeId,
        payload: { ...basePayload, disputeId }
      };
    }
    case "dispute_refunded":
    case "service_refunded":
      return {
        eventKey: `order.refunded:${order.id}`,
        eventType: "order.refunded",
        aggregateType: "order",
        aggregateId: order.id,
        payload: basePayload
      };
  }
}

function transitionActorId(actor: OrderTransitionActor): string | null {
  if (actor.kind === "user" || actor.role === "test_payment") return actor.id;
  return null;
}

async function assertActorPermission(
  client: pg.PoolClient,
  order: OrderRow,
  actor: OrderTransitionActor,
  reason: OrderTransitionReason,
  to: OrderStatus
) {
  const policy = REASON_POLICIES[reason];
  if (!policy.to.includes(to) || !policy.roles.includes(actor.role)) {
    throw forbidden("This actor cannot perform the requested order transition");
  }

  if (actor.role === "buyer" && actor.id !== order.buyer_id) {
    throw forbidden("Only the buyer can perform this order transition");
  }
  if (actor.role === "seller" && actor.id !== order.seller_id) {
    throw forbidden("Only the seller can perform this order transition");
  }
  if (
    actor.role === "participant" &&
    actor.id !== order.buyer_id &&
    actor.id !== order.seller_id
  ) {
    throw forbidden("Only an order participant can perform this transition");
  }
  if (actor.role === "test_payment" && actor.id !== order.buyer_id) {
    throw forbidden("Only the buyer can simulate payment for this order");
  }
  if (actor.role === "admin") {
    const user = await client.query<{ role: string }>(
      `select role from users where id = $1 for share`,
      [actor.id]
    );
    if (user.rows[0]?.role !== "admin") {
      throw forbidden("Only an admin can perform this order transition");
    }
  }
}

async function isIdempotentRepeat(
  client: pg.PoolClient,
  order: OrderRow,
  input: TransitionOrderInput
) {
  if (order.status !== input.to) return false;
  const event = eventDescriptor(input);
  const result = await client.query<{ exists: boolean }>(
    `select exists(
       select 1
       from order_events
       where order_id = $1
         and type = $2
         and metadata->'transition' @> $3::jsonb
     ) as "exists"`,
    [
      order.id,
      event.type,
      JSON.stringify({
        to: input.to,
        reason: input.reason,
        actor: input.actor
      })
    ]
  );
  return result.rows[0]?.exists === true;
}

/**
 * The only production status writer for an existing order.
 *
 * Callers may perform ledger writes, create a system message, or update non-lifecycle
 * order fields in the same transaction before invoking this function. The transition
 * itself owns the row lock, graph/actor checks, lifecycle timestamps, timeline event,
 * and durable outbox intent. It never calls a provider, Redis, a queue, or any other
 * external system.
 */
export async function transitionOrder(
  client: pg.PoolClient,
  input: TransitionOrderInput
): Promise<OrderRow> {
  const order = await selectOrderForUpdate(client, input.orderId);

  if (await isIdempotentRepeat(client, order, input)) return order;

  if (input.expectedFrom && !input.expectedFrom.includes(order.status)) {
    throw badRequest(`Order cannot transition from ${order.status} to ${input.to}`);
  }
  try {
    assertOrderTransition(order.status, input.to);
  } catch {
    throw badRequest(`Order cannot transition from ${order.status} to ${input.to}`);
  }
  await assertActorPermission(client, order, input.actor, input.reason, input.to);

  const from = order.status;
  const updated = await client.query<OrderRow>(
    `update orders
     set status = $2,
         paid_at = case
           when status = 'pending' and $2 in ('paid', 'delivered')
             then now()
           else paid_at
         end,
         delivered_at = case
           when $2 = 'delivered' then now()
           else delivered_at
         end,
         completed_at = case
           when $2 in ('completed', 'refunded') then now()
           else completed_at
         end,
         auto_release_at = case
           when $2 = 'delivered'
             then now() + make_interval(hours => $3::int)
           else auto_release_at
         end,
         updated_at = now()
     where id = $1
     returning ${orderRowColumns}`,
    [order.id, input.to, env.AUTO_RELEASE_HOURS]
  );
  const nextOrder = updated.rows[0];
  const descriptor = eventDescriptor(input);
  await recordOrderEvent(
    {
      orderId: order.id,
      actorId: transitionActorId(input.actor),
      type: descriptor.type,
      templateKey: descriptor.templateKey,
      body: descriptor.body,
      params: descriptor.params,
      metadata: {
        ...(descriptor.metadata ?? {}),
        transition: {
          from,
          to: input.to,
          reason: input.reason,
          actor: input.actor
        }
      }
    },
    client
  );
  await enqueueDomainEvent(client, outboxInput(nextOrder, input));
  return nextOrder;
}
