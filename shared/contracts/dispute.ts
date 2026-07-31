import type { IsoDateString } from "./common.js";
import type {
  CurrencyCode,
  DisputeDecision,
  DisputeStatus,
  OrderStatus
} from "./enums.js";
import type { MoneyCents } from "./money.js";

export type DisputeParticipantDto = {
  id: string;
  orderId: string;
  openedBy: string;
  reason: string;
  status: DisputeStatus;
  resolution: string | null;
  resolutionDecision: DisputeDecision | null;
  createdAt: IsoDateString;
  resolvedAt: IsoDateString | null;
};

export type DisputeModeratorDto = DisputeParticipantDto & {
  amountCents: MoneyCents;
  currency: CurrencyCode;
  orderStatus: OrderStatus;
  productTitle: string;
};

export type DisputeAdminDto = DisputeParticipantDto & {
  resolutionOperationId: string | null;
  resolvingStartedAt: IsoDateString | null;
  resolutionAttempts: number;
  lastResolutionError: string | null;
  adminId: string | null;
  adminNote: string | null;
  buyerId: string;
  sellerId: string;
  amountCents: MoneyCents;
  currency: CurrencyCode;
  orderStatus: OrderStatus;
  productTitle: string;
};

export type DisputeModeratorSummaryDto = DisputeModeratorDto & {
  buyerDisplayName: string;
  sellerDisplayName: string;
};

export type DisputeAdminSummaryDto = DisputeAdminDto & {
  buyerDisplayName: string;
  sellerDisplayName: string;
};
