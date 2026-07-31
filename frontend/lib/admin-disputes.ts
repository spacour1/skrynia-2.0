import type {
  DisputeDecision,
  DisputeStatus,
  Role
} from "./contracts";

export type DisputeLifecycle = {
  status: DisputeStatus;
  resolution?: DisputeDecision | null;
  resolutionDecision?: DisputeDecision | null;
  resolutionAttempts?: number;
  lastResolutionError?: string | null;
  createdAt?: string;
  resolvingStartedAt?: string | null;
  resolvedAt?: string | null;
};

export type DisputeFinancialAction =
  | { kind: "choose" }
  | { kind: "retry"; decision: DisputeDecision }
  | { kind: "in_progress" }
  | { kind: "none" };

/**
 * Financial dispute actions are deliberately centralized here so moderator
 * screens cannot accidentally expose refund/release controls.
 */
export function getDisputeFinancialAction(
  role: Role | undefined,
  dispute: DisputeLifecycle
): DisputeFinancialAction {
  if (role !== "admin") return { kind: "none" };
  if (dispute.status === "open") return { kind: "choose" };
  if (dispute.status === "resolving") return { kind: "in_progress" };
  if (dispute.status === "resolution_failed" && dispute.resolutionDecision) {
    return { kind: "retry", decision: dispute.resolutionDecision };
  }
  return { kind: "none" };
}

export function isResolutionTerminal(dispute: DisputeLifecycle) {
  return dispute.status === "resolved";
}
