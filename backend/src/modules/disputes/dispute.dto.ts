import {
  toInteger,
  toIsoDate,
  toMoneyCents,
  toNullableIsoDate,
  type DbDate
} from "../../common/dto.js";
import type {
  CurrencyCode,
  DisputeDecision,
  DisputeStatus,
  OrderStatus
} from "../../domain/enums.js";
import type { MoneyCentsInput } from "../../domain/money.js";

export type DisputeParticipantRow = {
  id: string;
  orderId: string;
  openedBy: string;
  reason: string;
  status: DisputeStatus;
  resolution: string | null;
  resolutionDecision: DisputeDecision | null;
  createdAt: DbDate;
  resolvedAt: DbDate | null;
};

export type DisputeStaffContextRow = DisputeParticipantRow & {
  buyerId: string;
  sellerId: string;
  amountCents: MoneyCentsInput;
  currency: CurrencyCode;
  orderStatus: OrderStatus;
  productTitle: string;
};

export type DisputeAdminRow = DisputeStaffContextRow & {
  resolutionOperationId: string | null;
  resolvingStartedAt: DbDate | null;
  resolutionAttempts: number | string | bigint;
  lastResolutionError: string | null;
  adminId: string | null;
  adminNote: string | null;
};

export type DisputeStaffSummaryRow = DisputeAdminRow & {
  buyerDisplayName: string;
  sellerDisplayName: string;
};

export function mapDisputeParticipantDto(row: DisputeParticipantRow) {
  return {
    id: row.id,
    orderId: row.orderId,
    openedBy: row.openedBy,
    reason: row.reason,
    status: row.status,
    resolution: row.resolution,
    resolutionDecision: row.resolutionDecision,
    createdAt: toIsoDate(row.createdAt),
    resolvedAt: toNullableIsoDate(row.resolvedAt)
  };
}

/**
 * Moderators may review the order context but cannot perform or inspect the internal
 * financial-resolution operation. Keep recovery, audit, and admin-note fields out of
 * this DTO even when the database row passed to the mapper contains them.
 */
export function mapDisputeModeratorDto(row: DisputeStaffContextRow) {
  return {
    ...mapDisputeParticipantDto(row),
    amountCents: toMoneyCents(row.amountCents),
    currency: row.currency,
    orderStatus: row.orderStatus,
    productTitle: row.productTitle
  };
}

export function mapDisputeAdminDto(row: DisputeAdminRow) {
  return {
    ...mapDisputeParticipantDto(row),
    resolutionOperationId: row.resolutionOperationId,
    resolvingStartedAt: toNullableIsoDate(row.resolvingStartedAt),
    resolutionAttempts: toInteger(row.resolutionAttempts),
    lastResolutionError: row.lastResolutionError,
    adminId: row.adminId,
    adminNote: row.adminNote,
    buyerId: row.buyerId,
    sellerId: row.sellerId,
    amountCents: toMoneyCents(row.amountCents),
    currency: row.currency,
    orderStatus: row.orderStatus,
    productTitle: row.productTitle
  };
}

export function mapDisputeModeratorSummaryDto(
  row: DisputeStaffSummaryRow
) {
  return {
    ...mapDisputeModeratorDto(row),
    buyerDisplayName: row.buyerDisplayName,
    sellerDisplayName: row.sellerDisplayName
  };
}

export function mapDisputeAdminSummaryDto(row: DisputeStaffSummaryRow) {
  return {
    ...mapDisputeAdminDto(row),
    buyerDisplayName: row.buyerDisplayName,
    sellerDisplayName: row.sellerDisplayName
  };
}
