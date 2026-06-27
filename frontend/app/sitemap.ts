import type { MetadataRoute } from "next";
import { fetchServerSide } from "../lib/server-api";
import { SITE_URL } from "../lib/site";

type GamesResponse = { games: { slug: string }[] };
type ProductsResponse = {
  products: { id: string; createdAt?: string }[];
  page: number;
  limit: number;
  total: number;
};

const MAX_PRODUCTS = 2000;
const PAGE_SIZE = 100;

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    { url: SITE_URL, changeFrequency: "daily", priority: 1 },
    { url: `${SITE_URL}/rules`, changeFrequency: "monthly", priority: 0.3 },
    { url: `${SITE_URL}/support`, changeFrequency: "monthly", priority: 0.3 }
  ];

  const games = await fetchServerSide<GamesResponse>("/marketplace/games", revalidate);
  for (const game of games?.games ?? []) {
    entries.push({ url: `${SITE_URL}/games/${game.slug}`, changeFrequency: "daily", priority: 0.7 });
  }

  let page = 1;
  let total = Infinity;
  while (entries.length < MAX_PRODUCTS && (page - 1) * PAGE_SIZE < total) {
    const data = await fetchServerSide<ProductsResponse>(
      `/marketplace/products?page=${page}&limit=${PAGE_SIZE}`,
      revalidate
    );
    if (!data || !data.products.length) break;
    total = data.total;
    for (const product of data.products) {
      entries.push({
        url: `${SITE_URL}/products/${product.id}`,
        lastModified: product.createdAt ? new Date(product.createdAt) : undefined,
        changeFrequency: "daily",
        priority: 0.6
      });
    }
    page += 1;
  }

  return entries;
}
