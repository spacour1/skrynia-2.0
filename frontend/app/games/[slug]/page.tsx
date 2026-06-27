import type { Metadata } from "next";
import type { Game } from "../../../lib/api";
import { fetchServerSide } from "../../../lib/server-api";
import { SITE_NAME, SITE_URL } from "../../../lib/site";
import { GameCatalogClient } from "./GameCatalogClient";

type GameResponse = { game: Game };

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const data = await fetchServerSide<GameResponse>(`/marketplace/games/${params.slug}`);
  if (!data) return { title: "Игра не найдена" };

  const title = `${data.game.name}: купить аккаунты, ключи и услуги`;
  const description = `Каталог лотов для ${data.game.name} на ${SITE_NAME}: аккаунты, ключи, бустинг и пополнения с безопасной сделкой через escrow.`;
  const url = `${SITE_URL}/games/${params.slug}`;

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, siteName: SITE_NAME }
  };
}

export default function GamePage({ params }: { params: { slug: string } }) {
  return <GameCatalogClient slug={params.slug} />;
}
