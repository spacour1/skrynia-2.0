import type { Metadata } from "next";
import type { Game } from "@/lib/api";
import { fetchServerSide } from "@/lib/server-api";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { defaultLocale, isLocale, locales } from "@/i18n/config";
import { getT } from "@/i18n/dictionaries";
import { GameCatalogClient } from "./GameCatalogClient";

type GameResponse = { game: Game };

export async function generateMetadata({ params }: { params: { slug: string; locale: string } }): Promise<Metadata> {
  const locale = isLocale(params.locale) ? params.locale : defaultLocale;
  const t = getT(locale);
  const data = await fetchServerSide<GameResponse>(`/marketplace/games/${params.slug}`);
  if (!data) return { title: t("catalog.gameNotFound") };

  // Admin-entered SEO from the catalog builder wins; the localized template is the fallback.
  const title = data.game.seoTitle || t("catalog.gameMetaTitle", { game: data.game.name });
  const description = data.game.seoDescription || data.game.shortDescription || t("catalog.gameMetaDescription", { game: data.game.name, site: SITE_NAME });
  const url = `${SITE_URL}/${locale}/games/${params.slug}`;
  const ogImage = data.game.banner || data.game.backgroundImage || undefined;

  return {
    title,
    description,
    alternates: {
      canonical: url,
      languages: Object.fromEntries(locales.map((item) => [item === "ua" ? "uk" : item, `${SITE_URL}/${item}/games/${params.slug}`]))
    },
    openGraph: { title, description, url, siteName: SITE_NAME, ...(ogImage ? { images: [{ url: ogImage }] } : {}) }
  };
}

export default function GamePage({ params }: { params: { slug: string } }) {
  return <GameCatalogClient slug={params.slug} />;
}
