import type { Product } from "./api";

export function productMediaUrls(product: Pick<Product, "media">): string[] {
  if (!Array.isArray(product.media)) return [];
  return product.media.map((item) => item.url).filter((url): url is string => typeof url === "string" && url.length > 0);
}

export function firstProductMedia(product: Pick<Product, "media">) {
  return productMediaUrls(product)[0] ?? null;
}
