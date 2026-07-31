import type { IsoDateString } from "./common.js";
import type { CurrencyCode, OrderStatus } from "./enums.js";
import type { MoneyCents } from "./money.js";

export type OrderMutationDto = {
  id: string;
  status: OrderStatus;
  productId: string;
  buyerId: string;
  sellerId: string;
  quantity: number;
  amountCents: MoneyCents;
  feeCents: MoneyCents;
  currency: CurrencyCode;
  deliveryNote: string | null;
  autoReleaseAt: IsoDateString | null;
  paidAt: IsoDateString | null;
  deliveredAt: IsoDateString | null;
  completedAt: IsoDateString | null;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
};

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

export type AdminOrderMutationDto = OrderMutationDto & {
  paymentProvider: string | null;
  paymentReference: string | null;
};

export type AdminPendingOrderDto = {
  id: string;
  amountCents: MoneyCents;
  currency: CurrencyCode;
  createdAt: IsoDateString;
  productTitle: string;
  buyerId: string;
  buyerDisplayName: string;
  buyerEmail: string;
  sellerDisplayName: string;
};
