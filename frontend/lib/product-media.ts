type ProductMediaInput = {
  media?: readonly { url?: string | null }[] | null;
};

export function productMediaUrls(product: ProductMediaInput): string[] {
  if (!Array.isArray(product.media)) return [];
  return product.media.map((item) => item.url).filter((url): url is string => typeof url === "string" && url.length > 0);
}

export function firstProductMedia(product: ProductMediaInput) {
  return productMediaUrls(product)[0] ?? null;
}
