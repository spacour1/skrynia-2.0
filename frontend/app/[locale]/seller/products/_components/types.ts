export type SellerProduct = {
  id: string;
  title: string;
  description: string;
  priceCents: number;
  currency: string;
  stock: number;
  status: string;
  categoryName: string;
  gameName?: string;
  sectionName?: string;
  deliveryType?: string;
  productType?: string;
  oldPriceCents?: number | null;
  salesCount?: number;
  metadata?: Record<string, unknown>;
  media?: { id: string; url: string; type: string; status?: string }[];
};

export type EditProduct = {
  id: string;
  title: string;
  description: string;
  price: string;
  stock: number;
};

export type LotForm = {
  title: string;
  shortDescription: string;
  description: string;
  categoryId: string;
  gameId: string;
  sectionId: string;
  productType: string;
  price: string;
  oldPrice: string;
  currency: string;
  stock: string;
  server: string;
  platform: string;
  region: string;
  rank: string;
  deliveryType: "manual" | "instant";
  deliveryTime: string;
  deliveryTemplate: string;
  autoDelivery: boolean;
  instantPublication: boolean;
};

export type SelectedMedia = {
  id: string;
  file: File;
  previewUrl: string;
};
