export type PublicSellerDto = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt: string;
  ratingAverage: number;
  reviewCount: number;
  online: boolean;
};

export type PublicSellerStatsDto = {
  activeListings: number;
  totalSales: number;
  favoriteCount: number;
  activeOrders: number;
  completedOrders: number;
  disputedOrders: number;
  refundedOrders: number;
  completedRevenueCents: string;
  successRate: number | null;
  hasEnoughData: boolean;
};

export type PublicSellerOverviewRow = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt: Date | string;
  ratingAverage: number | string | null;
  reviewCount: number | string;
  activeListings: number | string;
  totalSales: number | string;
  favoriteCount: number | string;
  activeOrders: number | string;
  completedOrders: number | string;
  disputedOrders: number | string;
  refundedOrders: number | string;
  completedRevenueCents: number | string;
  successRate: number | string | null;
  hasEnoughData: boolean;
};

function asNumber(value: number | string | null): number {
  return Number(value ?? 0);
}

export function toPublicSellerDto(row: PublicSellerOverviewRow, online: boolean): PublicSellerDto {
  return {
    id: row.id,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : new Date(row.createdAt).toISOString(),
    ratingAverage: asNumber(row.ratingAverage),
    reviewCount: asNumber(row.reviewCount),
    online
  };
}

export function toPublicSellerStatsDto(row: PublicSellerOverviewRow): PublicSellerStatsDto {
  return {
    activeListings: asNumber(row.activeListings),
    totalSales: asNumber(row.totalSales),
    favoriteCount: asNumber(row.favoriteCount),
    activeOrders: asNumber(row.activeOrders),
    completedOrders: asNumber(row.completedOrders),
    disputedOrders: asNumber(row.disputedOrders),
    refundedOrders: asNumber(row.refundedOrders),
    completedRevenueCents: String(row.completedRevenueCents ?? 0),
    successRate: row.successRate === null ? null : asNumber(row.successRate),
    hasEnoughData: row.hasEnoughData
  };
}
