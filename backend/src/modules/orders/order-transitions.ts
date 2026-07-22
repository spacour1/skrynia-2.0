import type { OrderStatus } from "../../domain/enums.js";

/**
 * The single source of truth for which order status transitions are legal. Reverse
 * engineered from the actual guards already enforced across lockEscrow, releaseEscrow,
 * refundEscrow, the seller start/deliver routes, the dispute-open route, and the mock
 * payment failure path (see docs/domain-invariants.md for the narrative version) - this
 * does not change the graph, it gives every one of those call sites one shared,
 * independently tested definition instead of seven copies of the same list.
 */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  pending: ["paid", "delivered", "canceled"],
  paid: ["in_progress", "delivered", "disputed", "refunded"],
  in_progress: ["delivered", "disputed", "refunded"],
  delivered: ["completed", "disputed", "refunded"],
  disputed: ["completed", "refunded"],
  completed: [],
  refunded: [],
  canceled: []
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}
