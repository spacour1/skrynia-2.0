import type { IsoDateString } from "./common.js";
import type { CurrencyCode, OrderStatus } from "./enums.js";
import type { MoneyCents } from "./money.js";

export type OrderSummaryDto = {
  id: string;
  status: OrderStatus;
  productId: string;
  productTitle: string;
  buyerId: string;
  buyerDisplayName: string;
  buyerAvatarUrl: string | null;
  sellerId: string;
  sellerDisplayName: string;
  sellerAvatarUrl: string | null;
  quantity: number;
  amountCents: MoneyCents;
  feeCents: MoneyCents;
  currency: CurrencyCode;
  createdAt: IsoDateString;
  paidAt: IsoDateString | null;
  deliveredAt: IsoDateString | null;
  autoReleaseAt: IsoDateString | null;
};

export type OrderDetailDto = OrderSummaryDto & {
  productDescription: string;
  deliveryNote: string | null;
  completedAt: IsoDateString | null;
  updatedAt: IsoDateString;
};

export type AdminOrderDto = OrderDetailDto & {
  paymentProvider: string | null;
  paymentReference: string | null;
};
