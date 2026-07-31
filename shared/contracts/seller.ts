import type { IsoDateString } from "./common.js";
import type { MoneyCents } from "./money.js";

export type PublicSellerDto = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt: IsoDateString;
  ratingAverage: number;
  reviewCount: number;
  online: boolean | null;
};

export type PublicSellerStatsDto = {
  activeListings: number;
  totalSales: number;
  favoriteCount: number;
  activeOrders: number;
  completedOrders: number;
  disputedOrders: number;
  refundedOrders: number;
  completedRevenueCents: MoneyCents;
  successRate: number | null;
  hasEnoughData: boolean;
};
