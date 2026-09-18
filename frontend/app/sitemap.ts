import type { MetadataRoute } from "next";
import { fetchServerSide } from "@/lib/server-api";
import { SITE_URL } from "@/lib/site";
import { defaultLocale, locales } from "@/i18n/config";

type GamesResponse = { games: { slug: string }[] };
type ProductsResponse = {
  products: { id: string; createdAt?: string }[];
  nextCursor: string | null;
};

const MAX_PRODUCTS = 2000;
const PAGE_SIZE = 100;

// Product visibility may change through moderation at any time. A cached sitemap would
// continue advertising hidden product IDs after the backend cache has been invalidated.
export const revalidate = 0;

// hreflang alternates for every entry: /ua is the default, /ru and /en are variants.
function withAlternates(path: string) {
  return {
    languages: Object.fromEntries(locales.map((locale) => [locale === "ua" ? "uk" : locale, `${SITE_URL}/${locale}${path}`]))
  };
}

function localizedUrl(path: string) {
  return `${SITE_URL}/${defaultLocale}${path}`;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/${defaultLocale}`, changeFrequency: "daily", priority: 1, alternates: withAlternates("") },
    { url: localizedUrl("/rules"), changeFrequency: "monthly", priority: 0.3, alternates: withAlternates("/rules") },
    { url: localizedUrl("/support"), changeFrequency: "monthly", priority: 0.3, alternates: withAlternates("/support") }
  ];

  const games = await fetchServerSide<GamesResponse>("/marketplace/games", revalidate);
  for (const game of games?.games ?? []) {
    entries.push({
      url: localizedUrl(`/games/${game.slug}`),
      changeFrequency: "daily",
      priority: 0.7,
      alternates: withAlternates(`/games/${game.slug}`)
    });
  }

  let cursor: string | null = null;
  const seenCursors = new Set<string>();
  while (entries.length < MAX_PRODUCTS) {
    const query = new URLSearchParams({ sort: "newest", limit: String(PAGE_SIZE) });
    if (cursor) query.set("cursor", cursor);
    const data = await fetchServerSide<ProductsResponse>(
      `/marketplace/products?${query.toString()}`,
      revalidate
    );
    if (!data || !data.products.length) break;
    for (const product of data.products) {
      if (entries.length >= MAX_PRODUCTS) break;
      entries.push({
        url: localizedUrl(`/products/${product.id}`),
        lastModified: product.createdAt ? new Date(product.createdAt) : undefined,
        changeFrequency: "daily",
        priority: 0.6,
        alternates: withAlternates(`/products/${product.id}`)
      });
    }
    if (!data.nextCursor || seenCursors.has(data.nextCursor)) break;
    seenCursors.add(data.nextCursor);
    cursor = data.nextCursor;
  }

  return entries;
}
