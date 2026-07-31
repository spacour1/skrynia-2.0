import { describe, expect, it } from "vitest";
import {
  getDisputeFinancialAction,
  isResolutionTerminal,
  type DisputeLifecycle
} from "@/lib/admin-disputes";
import type { Role } from "@/lib/contracts";

function dispute(
  status: DisputeLifecycle["status"],
  resolutionDecision?: DisputeLifecycle["resolutionDecision"]
): DisputeLifecycle {
  return { status, resolutionDecision };
}

describe("admin dispute lifecycle actions", () => {
  it("lets an admin choose a decision only for an open dispute", () => {
    expect(getDisputeFinancialAction("admin", dispute("open"))).toEqual({
      kind: "choose"
    });
    expect(getDisputeFinancialAction("admin", dispute("resolved"))).toEqual({
      kind: "none"
    });
  });

  it("shows an in-progress state without a second financial action", () => {
    expect(getDisputeFinancialAction("admin", dispute("resolving", "refund"))).toEqual({
      kind: "in_progress"
    });
  });

  it("retries only the persisted failed decision", () => {
    expect(
      getDisputeFinancialAction("admin", dispute("resolution_failed", "release"))
    ).toEqual({
      kind: "retry",
      decision: "release"
    });
    expect(
      getDisputeFinancialAction("admin", dispute("resolution_failed"))
    ).toEqual({
      kind: "none"
    });
  });

  it.each<Role>(["moderator", "user"])(
    "never exposes a financial action to a %s",
    (role) => {
      expect(getDisputeFinancialAction(role, dispute("open"))).toEqual({
        kind: "none"
      });
      expect(
        getDisputeFinancialAction(role, dispute("resolving", "refund"))
      ).toEqual({
        kind: "none"
      });
      expect(
        getDisputeFinancialAction(role, dispute("resolution_failed", "refund"))
      ).toEqual({
        kind: "none"
      });
    }
  );

  it("treats only resolved as terminal", () => {
    expect(isResolutionTerminal(dispute("resolved"))).toBe(true);
    expect(isResolutionTerminal(dispute("resolving"))).toBe(false);
    expect(isResolutionTerminal(dispute("resolution_failed"))).toBe(false);
  });
});
