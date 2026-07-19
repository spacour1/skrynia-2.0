import { randomUUID } from "node:crypto";
import type { DbClient } from "../../db/pool.js";
import { inTx, pool } from "../../db/pool.js";
import { conflict, notFound } from "../../common/errors.js";
import { logger } from "../../common/logger.js";
import { refundEscrow, releaseEscrow } from "../orders/ledger.service.js";
import { recordOrderEvent } from "../orders/order-events.service.js";
import { createOrderSystemMessage } from "../chat/system-messages.service.js";
import { enqueueDomainEvent } from "../outbox/outbox.service.js";

export type DisputeResolutionDecision = "refund" | "release";

const STALE_RESOLUTION_MS = 15 * 60 * 1000;
const LAST_ERROR_MAX_LENGTH = 1000;

type ResolutionRow = {
  id: string;
  order_id: string;
  status: "open" | "resolving" | "resolved" | "resolution_failed";
  resolution: DisputeResolutionDecision | null;
  resolution_decision: DisputeResolutionDecision | null;
  resolution_operation_id: string | null;
  resolving_started_at: Date | null;
  resolution_attempts: number;
  last_resolution_error: string | null;
  admin_id: string | null;
  admin_note: string | null;
  resolved_at: Date | null;
  order_status: string;
  buyer_id: string;
  seller_id: string;
};

type ResolutionClaim = {
  row: ResolutionRow;
  shouldExecuteEscrow: boolean;
  alreadyResolved: boolean;
};

export type DisputeResolutionResult = {
  dispute: ResolutionRow;
  order: unknown;
  newlyResolved: boolean;
  escrowExecuted: boolean;
  operationId: string;
};

function terminalDecision(orderStatus: string): DisputeResolutionDecision | null {
  if (orderStatus === "refunded") return "refund";
  if (orderStatus === "completed") return "release";
  return null;
}

function sanitizedError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown resolution failure";
  return message.slice(0, LAST_ERROR_MAX_LENGTH);
}

function assertDecisionMatches(
  persisted: DisputeResolutionDecision | null,
  requested: DisputeResolutionDecision
) {
  if (persisted && persisted !== requested) {
    throw conflict(`Dispute resolution is already claimed for ${persisted}`);
  }
}

function assertOperationMatches(persisted: string | null, expected?: string) {
  if (expected && persisted !== expected) {
    throw conflict("Dispute resolution operation changed");
  }
}

async function selectResolutionForUpdate(client: DbClient, disputeId: string) {
  const result = await client.query<ResolutionRow>(
    `select d.*,
            o.status as order_status,
            o.buyer_id,
            o.seller_id
     from disputes d
     join orders o on o.id = d.order_id
     where d.id = $1
     for update of d, o`,
    [disputeId]
  );
  const row = result.rows[0];
  if (!row) throw notFound("Dispute not found");
  return row;
}

function assertOrderCanContinue(row: ResolutionRow, decision: DisputeResolutionDecision) {
  const appliedDecision = terminalDecision(row.order_status);
  if (appliedDecision && appliedDecision !== decision) {
    throw conflict(`Order already has the opposite resolution: ${appliedDecision}`);
  }
  if (!appliedDecision && row.order_status !== "disputed") {
    throw conflict(`Order cannot be resolved from status ${row.order_status}`);
  }
}

async function claimResolution(input: {
  disputeId: string;
  decision: DisputeResolutionDecision;
  adminId: string;
  adminNote: string;
  expectedOperationId?: string;
  allowStale: boolean;
}): Promise<ResolutionClaim> {
  return inTx(async (client) => {
    let row = await selectResolutionForUpdate(client, input.disputeId);
    assertDecisionMatches(row.resolution_decision, input.decision);
    assertOperationMatches(row.resolution_operation_id, input.expectedOperationId);
    assertOrderCanContinue(row, input.decision);

    if (row.status === "resolved") {
      return { row, shouldExecuteEscrow: false, alreadyResolved: true };
    }

    if (row.status === "open") {
      const operationId = randomUUID();
      const claimed = await client.query<ResolutionRow>(
        `update disputes
         set status = 'resolving',
             resolution_decision = $2,
             resolution_operation_id = $3,
             admin_id = $4,
             admin_note = $5,
             resolving_started_at = now(),
             resolution_attempts = 1,
             last_resolution_error = null,
             updated_at = now()
         where id = $1
         returning *,
                   $6::text as order_status,
                   $7::uuid as buyer_id,
                   $8::uuid as seller_id`,
        [
          input.disputeId,
          input.decision,
          operationId,
          input.adminId,
          input.adminNote,
          row.order_status,
          row.buyer_id,
          row.seller_id
        ]
      );
      row = claimed.rows[0];
      return {
        row,
        shouldExecuteEscrow: terminalDecision(row.order_status) === null,
        alreadyResolved: false
      };
    }

    if (row.status === "resolution_failed") {
      const claimed = await client.query<ResolutionRow>(
        `update disputes
         set status = 'resolving',
             resolving_started_at = now(),
             resolution_attempts = resolution_attempts + 1,
             last_resolution_error = null,
             updated_at = now()
         where id = $1
         returning *,
                   $2::text as order_status,
                   $3::uuid as buyer_id,
                   $4::uuid as seller_id`,
        [input.disputeId, row.order_status, row.buyer_id, row.seller_id]
      );
      row = claimed.rows[0];
      return {
        row,
        shouldExecuteEscrow: terminalDecision(row.order_status) === null,
        alreadyResolved: false
      };
    }

    if (terminalDecision(row.order_status) === input.decision) {
      return { row, shouldExecuteEscrow: false, alreadyResolved: false };
    }

    const resolvingStartedAt = row.resolving_started_at
      ? new Date(row.resolving_started_at).getTime()
      : 0;
    const stale = resolvingStartedAt <= Date.now() - STALE_RESOLUTION_MS;
    if (!input.allowStale || !stale) {
      throw conflict("Dispute resolution is already in progress");
    }

    const reclaimed = await client.query<ResolutionRow>(
      `update disputes
       set resolving_started_at = now(),
           resolution_attempts = resolution_attempts + 1,
           last_resolution_error = null,
           updated_at = now()
       where id = $1
       returning *,
                 $2::text as order_status,
                 $3::uuid as buyer_id,
                 $4::uuid as seller_id`,
      [input.disputeId, row.order_status, row.buyer_id, row.seller_id]
    );
    row = reclaimed.rows[0];
    return {
      row,
      shouldExecuteEscrow: terminalDecision(row.order_status) === null,
      alreadyResolved: false
    };
  });
}

async function finalizeIfApplied(
  disputeId: string,
  decision: DisputeResolutionDecision,
  operationId: string
): Promise<{ row: ResolutionRow; newlyResolved: boolean } | null> {
  return inTx(async (client) => {
    const row = await selectResolutionForUpdate(client, disputeId);
    assertDecisionMatches(row.resolution_decision, decision);
    assertOperationMatches(row.resolution_operation_id, operationId);

    if (row.status === "resolved") {
      return { row, newlyResolved: false };
    }
    if (terminalDecision(row.order_status) !== decision) return null;

    const updated = await client.query<ResolutionRow>(
      `update disputes
       set status = 'resolved',
           resolution = resolution_decision,
           resolved_at = coalesce(resolved_at, now()),
           last_resolution_error = null,
           updated_at = now()
       where id = $1
       returning *,
                 $2::text as order_status,
                 $3::uuid as buyer_id,
                 $4::uuid as seller_id`,
      [disputeId, row.order_status, row.buyer_id, row.seller_id]
    );
    const resolved = updated.rows[0];
    await recordOrderEvent(
      {
        orderId: resolved.order_id,
        actorId: resolved.admin_id,
        type: "dispute_resolved",
        templateKey: "orderEvents.disputeResolved",
        // The original claim note is preserved across retries and recovery.
        body: resolved.admin_note ?? undefined,
        metadata: { decision, operationId }
      },
      client
    );
    const resolutionMessage = await createOrderSystemMessage(
      {
        orderId: resolved.order_id,
        type: "dispute_resolved",
        bodyKey: "system.disputeResolved",
        params: { note: resolved.admin_note ?? "" },
        metadata: { decision, operationId }
      },
      client
    );
    const outcomeMessage = await createOrderSystemMessage(
      {
        orderId: resolved.order_id,
        type: decision === "refund" ? "refunded" : "escrow_released",
        bodyKey:
          decision === "refund" ? "system.refunded" : "system.fundsReleased"
      },
      client
    );
    await enqueueDomainEvent(client, {
      eventKey: `dispute.resolved:${disputeId}:${operationId}`,
      eventType: "dispute.resolved",
      aggregateType: "dispute",
      aggregateId: disputeId,
      payload: {
        disputeId,
        orderId: resolved.order_id,
        buyerId: resolved.buyer_id,
        sellerId: resolved.seller_id,
        decision,
        systemMessageIds: [resolutionMessage?.id, outcomeMessage?.id].filter(
          (id): id is string => Boolean(id)
        )
      }
    });
    return { row: resolved, newlyResolved: true };
  });
}

async function markResolutionFailed(
  disputeId: string,
  operationId: string,
  error: unknown
) {
  await pool.query(
    `update disputes
     set status = 'resolution_failed',
         last_resolution_error = $3,
         updated_at = now()
     where id = $1
       and resolution_operation_id = $2
       and status = 'resolving'`,
    [disputeId, operationId, sanitizedError(error)]
  );
}

export async function resolveDisputeResolution(input: {
  disputeId: string;
  decision: DisputeResolutionDecision;
  adminId: string;
  adminNote: string;
  expectedOperationId?: string;
  allowStale?: boolean;
}): Promise<DisputeResolutionResult> {
  const claim = await claimResolution({
    ...input,
    allowStale: input.allowStale ?? true
  });
  const operationId = claim.row.resolution_operation_id;
  if (!operationId) throw new Error("Claimed dispute is missing a resolution operation ID");

  if (claim.alreadyResolved) {
    return {
      dispute: claim.row,
      order: null,
      newlyResolved: false,
      escrowExecuted: false,
      operationId
    };
  }

  let order: unknown = null;
  let escrowExecuted = false;
  if (claim.shouldExecuteEscrow) {
    try {
      order =
        input.decision === "refund"
          ? await refundEscrow(claim.row.order_id, claim.row.admin_id ?? input.adminId)
          : await releaseEscrow(claim.row.order_id, {
              adminId: claim.row.admin_id ?? input.adminId,
              source: "dispute"
            });
      escrowExecuted = true;
    } catch (error) {
      const applied = await finalizeIfApplied(input.disputeId, input.decision, operationId);
      if (applied) {
        return {
          dispute: applied.row,
          order: null,
          newlyResolved: applied.newlyResolved,
          escrowExecuted: false,
          operationId
        };
      }
      await markResolutionFailed(input.disputeId, operationId, error);
      throw error;
    }
  }

  const finalized = await finalizeIfApplied(input.disputeId, input.decision, operationId);
  if (!finalized) {
    const error = conflict("Escrow operation did not reach the expected terminal order status");
    await markResolutionFailed(input.disputeId, operationId, error);
    throw error;
  }

  return {
    dispute: finalized.row,
    order,
    newlyResolved: finalized.newlyResolved,
    escrowExecuted,
    operationId
  };
}

export async function recoverStaleDisputeResolutions(disputeId?: string) {
  const stale = await pool.query<{ id: string }>(
    `select id
     from disputes
     where status = 'resolving'
       and resolving_started_at <= now() - interval '15 minutes'
       and ($1::uuid is null or id = $1)
     order by resolving_started_at, id
     limit 25`,
    [disputeId ?? null]
  );

  const results: DisputeResolutionResult[] = [];
  for (const item of stale.rows) {
    const current = await pool.query<{
      decision: DisputeResolutionDecision;
      operationId: string;
      adminId: string;
      adminNote: string | null;
    }>(
      `select resolution_decision as decision,
              resolution_operation_id as "operationId",
              admin_id as "adminId",
              admin_note as "adminNote"
       from disputes
       where id = $1 and status = 'resolving'`,
      [item.id]
    );
    const resolution = current.rows[0];
    if (!resolution?.decision || !resolution.operationId || !resolution.adminId) {
      logger.error({ disputeId: item.id }, "stale_dispute_resolution_missing_claim_data");
      continue;
    }

    try {
      const result = await resolveDisputeResolution({
        disputeId: item.id,
        decision: resolution.decision,
        adminId: resolution.adminId,
        adminNote: resolution.adminNote ?? "Recovered stale dispute resolution",
        expectedOperationId: resolution.operationId,
        allowStale: true
      });
      results.push(result);
      logger.info(
        {
          disputeId: item.id,
          operationId: result.operationId,
          escrowExecuted: result.escrowExecuted
        },
        "stale_dispute_resolution_recovered"
      );
    } catch (error) {
      logger.error({ disputeId: item.id, error }, "stale_dispute_resolution_failed");
    }
  }
  return results;
}
