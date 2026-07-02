"use client";

import { useRouter } from "@/lib/navigation";
import type { FormEvent } from "react";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
  Headphones,
  MessageCircle,
  PackageCheck,
  Send,
  ShieldCheck,
  ShoppingBag,
  Trophy,
  Zap,
  type LucideIcon
} from "lucide-react";
import { GameIcon } from "../../components/GameIcon";
import { ProductCard } from "../../components/ProductCard";
import { apiFetch, type Game, type Product } from "../../lib/api";
import { useAuth } from "../../lib/auth-store";
import { showAppToast } from "../../lib/toast-events";

type CategoryTile = {
  id: string;
  slug: string;
  name: string;
  publisher?: string | null;
  lotCount?: number;
};

type GameTileThemeConfig = {
  gradient: string;
  panel: string;
  border: string;
  glow: string;
  logo: string;
  caption: string;
  scene: "platform" | "shooter" | "fantasy" | "brawler" | "royal";
  image?: string;
};

type ChatMessage = {
  id: string;
  name: string;
  text: string;
  time: string;
  avatar: string;
};

const fallbackMobileGames: CategoryTile[] = [
  { id: "fallback-pubg", slug: "pubg", name: "PUBG Mobile", publisher: "Mobile", lotCount: 248 },
  { id: "fallback-free-fire", slug: "free-fire", name: "Free Fire", publisher: "Garena", lotCount: 186 },
  { id: "fallback-genshin", slug: "genshin-impact", name: "Genshin Impact", publisher: "HoYoverse", lotCount: 122 },
  { id: "fallback-brawl", slug: "brawl-stars", name: "Brawl Stars", publisher: "Supercell", lotCount: 94 },
  { id: "fallback-clash", slug: "clash-of-clans", name: "Clash of Clans", publisher: "Supercell", lotCount: 81 },
  { id: "fallback-clash-royale", slug: "clash-royale", name: "Clash Royale", publisher: "Supercell", lotCount: 73 },
  { id: "fallback-mobile-legends", slug: "mobile-legends", name: "Mobile Legends", publisher: "Moonton", lotCount: 112 },
  { id: "fallback-wild-rift", slug: "league-wild-rift", name: "League of Legends: Wild Rift", publisher: "Riot Games", lotCount: 91 },
  { id: "fallback-roblox", slug: "roblox", name: "Roblox", publisher: "Roblox", lotCount: 143 },
  { id: "fallback-standoff", slug: "standoff-2", name: "Standoff 2", publisher: "AXLEBOLT", lotCount: 77 },
  { id: "fallback-arena-breakout", slug: "arena-breakout", name: "Arena Breakout", publisher: "MoreFun", lotCount: 45 },
  { id: "fallback-cod-mobile", slug: "call-of-duty-mobile", name: "COD Mobile", publisher: "Activision", lotCount: 69 }
];

const fallbackPlatforms: CategoryTile[] = [
  { id: "fallback-steam", slug: "steam", name: "Steam", publisher: "PC", lotCount: 430 },
  { id: "fallback-epic", slug: "epic-games", name: "Epic Games Store", publisher: "PC", lotCount: 126 },
  { id: "fallback-playstation", slug: "playstation", name: "PlayStation", publisher: "Console", lotCount: 170 },
  { id: "fallback-xbox", slug: "xbox", name: "Xbox", publisher: "Console", lotCount: 98 },
  { id: "fallback-battle-net", slug: "battle-net", name: "Battle.net", publisher: "PC", lotCount: 74 },
  { id: "fallback-nintendo", slug: "nintendo", name: "Nintendo", publisher: "Console", lotCount: 63 },
  { id: "fallback-ubisoft", slug: "ubisoft-connect", name: "Ubisoft Connect", publisher: "PC", lotCount: 58 },
  { id: "fallback-ea", slug: "ea-app", name: "EA App", publisher: "PC", lotCount: 66 },
  { id: "fallback-rockstar", slug: "rockstar", name: "Rockstar", publisher: "PC", lotCount: 101 },
  { id: "fallback-gog", slug: "gog", name: "GOG", publisher: "PC", lotCount: 42 }
];

const fallbackPopular: CategoryTile[] = [
  { id: "fallback-cs2", slug: "cs2", name: "CS2", publisher: "Valve", lotCount: 315 },
  { id: "fallback-dota", slug: "dota-2", name: "Dota 2", publisher: "Valve", lotCount: 284 },
  { id: "fallback-valorant", slug: "valorant", name: "Valorant", publisher: "Riot Games", lotCount: 201 },
  { id: "fallback-rust", slug: "rust", name: "Rust", publisher: "Facepunch", lotCount: 93 },
  { id: "fallback-warzone", slug: "call-of-duty", name: "Call of Duty Warzone", publisher: "Activision", lotCount: 116 },
  { id: "fallback-fortnite", slug: "fortnite", name: "Fortnite", publisher: "Epic Games", lotCount: 156 },
  { id: "fallback-gta", slug: "gta-online", name: "GTA V", publisher: "Rockstar", lotCount: 141 },
  { id: "fallback-apex", slug: "apex-legends", name: "Apex Legends", publisher: "EA", lotCount: 87 },
  { id: "fallback-minecraft", slug: "minecraft", name: "Minecraft", publisher: "Mojang", lotCount: 132 },
  { id: "fallback-league", slug: "league-of-legends", name: "League of Legends", publisher: "Riot Games", lotCount: 118 }
];

const initialChatMessages: ChatMessage[] = [
  { id: "m1", name: "ShadowHunter", text: "Хтось продає акаунт з PSN?", time: "16:52", avatar: "/avatars/keyforge-market.svg" },
  { id: "m2", name: "Kira", text: "Шукаю рідкісні скіни на CS2", time: "16:53", avatar: "/avatars/neon-dragon.svg" },
  { id: "m3", name: "NecX", text: "Підкажіть, як працює гарантія?", time: "16:54", avatar: "/avatars/void-samurai.svg" },
  { id: "m4", name: "GameLord", text: "Куплю ключ, все супер, дякую!", time: "16:55", avatar: "/avatars/solar-orb.svg" },
  { id: "m5", name: "Viper", text: "Обміняю акаунт на щось цікаве", time: "16:55", avatar: "/avatars/neon-dragon.svg" }
];

export default function HomePage() {
  const router = useRouter();
  const client = useQueryClient();
  const user = useAuth((s) => s.user);

  const games = useQuery({
    queryKey: ["games"],
    queryFn: () => apiFetch<{ games: Game[] }>("/marketplace/games")
  });
  const products = useQuery({
    queryKey: ["home-products"],
    queryFn: () => apiFetch<{ products: Product[]; total?: number }>("/marketplace/products?limit=12&sort=newest")
  });
  const favoriteIds = useQuery({
    queryKey: ["favorite-ids"],
    queryFn: () => apiFetch<{ productIds: string[] }>("/marketplace/favorites/ids"),
    enabled: Boolean(user)
  });
  const likeMutation = useMutation({
    mutationFn: ({ productId, liked }: { productId: string; liked: boolean }) =>
      apiFetch(`/marketplace/favorites/${productId}`, { method: liked ? "DELETE" : "PUT" }),
    onMutate: async ({ productId, liked }) => {
      await client.cancelQueries({ queryKey: ["favorite-ids"] });
      const previous = client.getQueryData<{ productIds: string[] }>(["favorite-ids"]);
      client.setQueryData<{ productIds: string[] }>(["favorite-ids"], (current) => {
        const ids = current?.productIds ?? [];
        return { productIds: liked ? ids.filter((id) => id !== productId) : Array.from(new Set([productId, ...ids])) };
      });
      return { previous };
    },
    onError: (error, _variables, context) => {
      if (context?.previous) client.setQueryData(["favorite-ids"], context.previous);
      if ((error as { status?: number }).status === 401) router.push("/login");
    },
    onSuccess: (_data, variables) => {
      client.invalidateQueries({ queryKey: ["favorite-ids"] });
      client.invalidateQueries({ queryKey: ["home-products"] });
      showAppToast({
        type: "favorite",
        title: variables.liked ? "Лот прибрано з обраного" : "Лот додано в обране",
        productId: variables.productId
      });
    }
  });

  const gamesList = games.data?.games ?? [];
  const productsList = products.data?.products ?? [];
  const likedSet = new Set(favoriteIds.data?.productIds ?? []);
  const mobileGames = mergeTiles(
    pickTiles(gamesList, /pubg|free|genshin|brawl|clash|mobile|standoff|roblox|call-of-duty-mobile|arena|wild-rift/i, fallbackMobileGames),
    fallbackMobileGames
  );
  const platformGames = mergeTiles(
    pickTiles(gamesList, /steam|epic|playstation|xbox|battle|nintendo|ubisoft|ea|rockstar|gog/i, fallbackPlatforms),
    fallbackPlatforms
  );
  const popularGames = mergeTiles(
    pickTiles(gamesList, /cs2|counter|dota|valorant|rust|warzone|fortnite|gta|apex|minecraft|league|call-of-duty/i, fallbackPopular),
    fallbackPopular
  );
  const knownGameSlugs = new Set(gamesList.map((game) => game.slug));
  const tileNameBySlug = new Map([...fallbackMobileGames, ...fallbackPlatforms, ...fallbackPopular, ...gamesList].map((item) => [item.slug, item.name]));

  function selectGame(slug: string) {
    if (!knownGameSlugs.has(slug)) {
      router.push(`/?q=${encodeURIComponent(tileNameBySlug.get(slug) ?? slug)}`);
      return;
    }
    router.push(`/games/${slug}`);
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_360px]">
      <main className="min-w-0 space-y-6">
        <Hero />

        <section id="game-catalog" className="space-y-7 scroll-mt-28">
          <CategoryCarousel title="Мобільні ігри" items={mobileGames} onSelect={selectGame} />
          <CategoryCarousel title="ПК та консольні ігри" items={platformGames} onSelect={selectGame} compact />
          <CategoryCarousel title="Популярні тайтли" items={popularGames} onSelect={selectGame} />
        </section>

        <section id="listing-catalog" className="space-y-4 scroll-mt-28">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-black uppercase text-brand">Каталог</p>
              <h2 className="text-2xl font-black text-ink">Оголошення</h2>
              <p className="text-sm text-muted">Реальні лоти з існуючого marketplace API.</p>
            </div>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-lg border border-line bg-card px-4 py-2 text-sm font-bold text-muted transition hover:border-brand/60 hover:bg-panel hover:text-brand"
              onClick={() => router.push("/seller/create")}
            >
              Додати лот
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {products.isLoading ? (
            <section className="rounded-lg border border-line bg-card p-8 text-center text-muted">Завантажуємо оголошення...</section>
          ) : productsList.length ? (
            <div className="grid gap-5 sm:grid-cols-2 2xl:grid-cols-4">
              {productsList.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          ) : (
            <section className="rounded-lg border border-line bg-card p-8 text-center text-muted">Оголошення не знайдені.</section>
          )}
        </section>
      </main>

      <aside className="space-y-4 xl:sticky xl:top-[106px] xl:self-start">
        <GeneralChatWidget />
        <RecentChatsWidget onOpen={(href) => router.push(user ? href : "/login")} />
        <SupportWidget onOpen={() => router.push("/support")} />
      </aside>
    </div>
  );
}

function Hero() {
  const benefits = [
    { title: "Безпечно", text: "Угода через гаранта", icon: PackageCheck },
    { title: "Швидко", text: "Миттєва доставка", icon: Zap },
    { title: "Надійно", text: "Підтримка 24/7", icon: ShieldCheck },
    { title: "Великий вибір", text: "Тисячі пропозицій", icon: Trophy }
  ];

  return (
    <section className="relative min-h-[330px] overflow-hidden rounded-lg border border-line bg-card shadow-lift">
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(3,7,11,0.98)_0%,rgba(3,7,11,0.84)_34%,rgba(3,7,11,0.38)_72%),radial-gradient(circle_at_77%_28%,rgba(255,190,26,0.28),transparent_18rem),radial-gradient(circle_at_64%_60%,rgba(83,154,255,0.20),transparent_22rem),linear-gradient(135deg,#070d15_0%,#101827_45%,#05070b_100%)]" />
      <div className="absolute right-0 top-0 h-full w-[62%] opacity-75">
        <div className="absolute bottom-0 right-8 h-[58%] w-[82%] bg-[radial-gradient(ellipse_at_bottom,rgba(0,0,0,0.95),transparent_64%)]" />
        <div className="absolute bottom-9 right-[24%] h-28 w-5 rounded-t-full bg-black/65 shadow-[32px_10px_0_3px_rgba(0,0,0,0.45),68px_22px_0_0_rgba(0,0,0,0.4),-35px_20px_0_-2px_rgba(0,0,0,0.38)]" />
        <div className="absolute right-[18%] top-12 h-20 w-44 -skew-x-12 rounded-full bg-slate-900/60 blur-[1px]" />
        <div className="absolute right-[40%] top-20 h-16 w-32 -skew-x-12 rounded-full bg-slate-900/50 blur-[1px]" />
        <div className="absolute bottom-0 right-0 h-28 w-full bg-gradient-to-t from-black/70 to-transparent" />
      </div>

      <div className="relative z-10 flex min-h-[330px] flex-col justify-center px-5 py-10 sm:px-8 lg:px-20">
        <h1 className="max-w-[670px] text-4xl font-black leading-[1.12] tracking-normal text-ink md:text-5xl">
          Купуй та продавай
          <span className="block text-brand">ігрові акаунти, предмети,</span>
          <span className="block text-brand">ключі та послуги</span>
        </h1>
        <div className="mt-10 grid max-w-4xl gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {benefits.map((item) => (
            <Benefit key={item.title} {...item} />
          ))}
        </div>
      </div>
    </section>
  );
}

function Benefit({ title, text, icon: Icon }: { title: string; text: string; icon: LucideIcon }) {
  return (
    <article className="flex items-center gap-3">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand/12 text-brand ring-1 ring-brand/20">
        <Icon className="h-5 w-5" />
      </span>
      <span>
        <span className="block text-sm font-black text-ink">{title}</span>
        <span className="mt-0.5 block text-xs text-muted">{text}</span>
      </span>
    </article>
  );
}

function CategoryCarousel({ title, items, onSelect, compact }: { title: string; items: CategoryTile[]; onSelect: (slug: string) => void; compact?: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  function scroll(direction: number) {
    scrollRef.current?.scrollBy({ left: direction * 520, behavior: "smooth" });
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <button className="inline-flex items-center gap-2 text-left text-xl font-black text-ink transition hover:text-brand" onClick={() => scroll(1)}>
          {title}
          <ChevronRight className="h-5 w-5 text-brand" />
        </button>
        <div className="hidden gap-2 sm:flex">
          <button className="grid h-9 w-9 place-items-center rounded-lg border border-line bg-card text-muted hover:border-brand hover:text-brand" onClick={() => scroll(-1)} aria-label="Назад">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button className="grid h-9 w-9 place-items-center rounded-lg border border-line bg-card text-muted hover:border-brand hover:text-brand" onClick={() => scroll(1)} aria-label="Вперед">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div ref={scrollRef} className="flex gap-4 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((item) => {
          const tile = gameTileTheme(item.slug, item.name);
          return (
            <button
              key={item.id}
              className={`group relative shrink-0 overflow-hidden rounded-lg border bg-[#03070d] text-left shadow-[0_14px_34px_rgba(0,0,0,0.28)] transition duration-300 hover:-translate-y-0.5 hover:shadow-lift ${tile.border} ${
                compact ? "h-20 w-[230px]" : "h-24 w-[232px]"
              }`}
              onClick={() => onSelect(item.slug)}
              title={item.name}
            >
              <GameTileBackdrop name={item.name} slug={item.slug} tile={tile} compact={Boolean(compact)} />
              {!tile.image ? (
                <div className="relative z-10 flex h-full items-center gap-4 px-4">
                  <span className={`${compact ? "h-[58px] w-[58px]" : "h-[72px] w-[72px]"} relative grid shrink-0 place-items-center rounded-full border border-white/10 bg-black/35 shadow-[0_0_32px_rgba(255,255,255,0.08)] backdrop-blur-sm`}>
                    <span className={`absolute inset-0 rounded-full ${tile.glow}`} />
                    <GameIcon name={item.name} slug={item.slug} className={`${compact ? "h-11 w-11" : "h-[54px] w-[54px]"} rounded-2xl ring-1 ring-white/25`} />
                  </span>
                  <span className="min-w-0 flex-1 pr-10">
                    <span className={`block truncate font-black uppercase leading-none tracking-normal text-white drop-shadow-[0_3px_14px_rgba(0,0,0,0.72)] ${compact ? "text-[19px]" : "text-[22px]"}`}>
                      {tile.logo}
                    </span>
                    <span className="mt-2 block truncate text-[11px] font-semibold uppercase tracking-normal text-white/68">{tile.caption}</span>
                  </span>
                </div>
              ) : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function GameTileBackdrop({ name, slug, tile, compact }: { name: string; slug: string; tile: GameTileThemeConfig; compact: boolean }) {
  return (
    <>
      {tile.image ? <img className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-[1.035]" src={tile.image} alt="" loading="lazy" draggable={false} /> : null}
      {!tile.image ? <div className={`absolute inset-0 bg-gradient-to-br ${tile.gradient}`} /> : null}
      <div className={`absolute inset-0 ${tile.image ? "bg-[linear-gradient(90deg,rgba(2,6,12,0.10),rgba(2,6,12,0.02)_48%,rgba(2,6,12,0.10))]" : "bg-[linear-gradient(90deg,rgba(2,6,12,0.95)_0%,rgba(2,6,12,0.62)_45%,rgba(2,6,12,0.18)_72%,rgba(2,6,12,0.72)_100%),radial-gradient(circle_at_45%_88%,rgba(255,255,255,0.16),transparent_34%),linear-gradient(145deg,rgba(255,255,255,0.12)_0%,transparent_26%,rgba(0,0,0,0.38)_76%)]"}`} />
      {!tile.image ? <div className={`absolute -bottom-8 left-[18%] h-20 w-[62%] rounded-full blur-2xl ${tile.panel}`} /> : null}
      <div className="absolute inset-x-4 bottom-0 h-px bg-white/12" />
      <div className={`absolute inset-0 rounded-xl opacity-80 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.045)] ${tile.glow}`} />
      {!tile.image ? (
        <>
          <div className="absolute left-7 top-3 h-2 w-1 rounded-full bg-white/35 blur-[1px]" />
          <div className="absolute left-[48%] top-5 h-1.5 w-1.5 rounded-full bg-white/30 blur-[1px]" />
          {tile.scene === "platform" ? <PlatformTileScene slug={slug} tile={tile} compact={compact} /> : <GameTileScene slug={slug} tile={tile} compact={compact} />}
          <GameIcon name={name} slug={slug} className={`${compact ? "h-[86px] w-[86px]" : "h-[104px] w-[104px]"} absolute -right-7 -top-7 opacity-[0.16] blur-[0.3px] transition duration-300 group-hover:scale-110 group-hover:opacity-[0.24]`} />
        </>
      ) : null}
    </>
  );
}

function PlatformTileScene({ slug, tile, compact }: { slug: string; tile: GameTileThemeConfig; compact: boolean }) {
  const isXbox = slug === "xbox";
  const isPlayStation = slug === "playstation";
  const isBattleNet = slug === "battle-net";
  const isSteam = slug === "steam";

  return (
    <div className="absolute inset-y-2 right-2 w-[48%] opacity-70 transition duration-300 group-hover:opacity-90">
      <div className="absolute inset-y-1 right-0 w-[92%] -skew-x-6 rounded-lg border border-white/10 bg-black/28 shadow-[0_0_28px_rgba(56,189,248,0.12)] backdrop-blur-[1px]" />
      <div className="absolute inset-y-3 right-3 grid w-[74%] grid-cols-2 gap-1.5">
        {Array.from({ length: 4 }).map((_, index) => (
          <span key={index} className={`rounded-md border border-white/[0.08] bg-white/[0.055] ${index === 0 ? tile.panel : ""}`}>
            <span className="mt-2 block h-1.5 w-8 rounded-full bg-white/15" />
            <span className="mx-auto mt-2 block h-5 w-5 rounded-md border border-white/10 bg-white/10" />
          </span>
        ))}
      </div>
      {isBattleNet ? <span className="absolute right-4 top-4 h-14 w-14 rounded-full border border-sky-300/25 shadow-[0_0_28px_rgba(56,189,248,0.35)]" /> : null}
      {isSteam ? <span className="absolute bottom-3 right-4 h-8 w-16 rounded-md border border-sky-200/20 bg-sky-300/10" /> : null}
      {isPlayStation ? <span className="absolute bottom-4 right-6 h-8 w-20 rounded-full bg-blue-400/18 blur-sm" /> : null}
      {isXbox ? <span className="absolute bottom-3 right-3 h-10 w-24 rounded-md bg-green-300/14" /> : null}
    </div>
  );
}

function GameTileScene({ slug, tile, compact }: { slug: string; tile: GameTileThemeConfig; compact: boolean }) {
  const isFantasy = tile.scene === "fantasy" || tile.scene === "royal";
  const isBrawler = tile.scene === "brawler";
  const figureHeight = compact ? "h-[86px]" : "h-[108px]";

  return (
    <div className="absolute inset-y-0 right-0 w-[48%] overflow-hidden opacity-[0.82] transition duration-300 group-hover:opacity-100">
      <div className={`absolute bottom-0 right-5 ${figureHeight} w-16 rounded-t-[42px] bg-gradient-to-b ${isFantasy ? "from-amber-200/70 via-orange-700/40 to-black/70" : isBrawler ? "from-yellow-300/70 via-orange-700/40 to-black/75" : "from-zinc-200/50 via-stone-700/40 to-black/80"} shadow-[0_0_32px_rgba(0,0,0,0.45)]`} />
      <div className={`absolute right-4 top-4 h-11 w-16 rounded-full ${isFantasy ? "bg-amber-200/25" : isBrawler ? "bg-orange-300/20" : "bg-stone-200/15"} blur-sm`} />
      <div className={`absolute bottom-0 right-0 h-16 w-[92%] bg-gradient-to-t ${isFantasy ? "from-amber-600/20" : isBrawler ? "from-orange-600/25" : "from-stone-500/20"} to-transparent`} />
      <div className={`absolute bottom-2 right-8 h-7 w-24 -rotate-12 rounded-full ${tile.panel} blur-[1px]`} />
      {tile.scene === "shooter" ? <span className="absolute bottom-5 right-7 h-3 w-24 -rotate-[22deg] rounded-full bg-zinc-200/25 shadow-[0_0_18px_rgba(251,191,36,0.18)]" /> : null}
      {slug === "pubg" || slug === "standoff-2" || slug === "arena-breakout" || slug === "call-of-duty-mobile" ? (
        <span className="absolute right-10 top-4 h-7 w-12 rounded-t-full border border-amber-200/20 bg-black/30" />
      ) : null}
      {slug === "genshin-impact" || slug === "league-wild-rift" || slug === "mobile-legends" ? (
        <span className="absolute right-0 top-3 h-16 w-16 rounded-full border border-cyan-200/20 bg-cyan-300/10 blur-[1px]" />
      ) : null}
      {slug === "clash-royale" ? <span className="absolute right-10 top-2 h-8 w-10 rounded-t-lg bg-yellow-300/30" /> : null}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_28%,rgba(255,255,255,0.16),transparent_20%),linear-gradient(90deg,transparent,rgba(0,0,0,0.18))]" />
    </div>
  );
}

function GeneralChatWidget() {
  const [messages, setMessages] = useState(initialChatMessages);
  const [text, setText] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    setMessages((current) => [
      ...current.slice(-5),
      {
        id: `local-${Date.now()}`,
        name: "Ти",
        text: value,
        time: new Date().toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" }),
        avatar: "/avatars/solar-orb.svg"
      }
    ]);
    setText("");
  }

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-card shadow-soft">
      <div className="flex items-center justify-between gap-3 px-5 py-4">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-black text-ink">Загальний чат онлайн</h2>
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_18px_rgba(52,211,153,0.7)]" />
        </div>
        <span className="rounded-full bg-panel px-2 py-1 text-xs font-bold text-ink">1284</span>
      </div>
      <div className="space-y-3 px-5 pb-4">
        {messages.slice(-6).map((message) => (
          <article key={message.id} className="flex items-start gap-3">
            <img className="h-8 w-8 rounded-full border border-line bg-panel object-cover" src={message.avatar} alt="" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-sm font-black text-ink">{message.name}</span>
                <span className="shrink-0 text-xs text-muted">{message.time}</span>
              </div>
              <p className="mt-0.5 line-clamp-1 text-xs text-muted">{message.text}</p>
            </div>
            <span className="mt-2 h-2 w-2 rounded-full bg-emerald-400" />
          </article>
        ))}
      </div>
      <form className="flex border-t border-line" onSubmit={submit}>
        <input
          className="min-w-0 flex-1 border-0 bg-panel/45 px-4 py-3 text-sm outline-none placeholder:text-muted"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Написати повідомлення..."
        />
        <button className="grid w-12 place-items-center bg-panel/45 text-brand transition hover:bg-brand hover:text-stone-950 disabled:text-muted" disabled={!text.trim()} aria-label="Надіслати">
          <Send className="h-5 w-5" />
        </button>
      </form>
    </section>
  );
}

function RecentChatsWidget({ onOpen }: { onOpen: (href: string) => void }) {
  const items = [
    { title: "Підтримка SKRYNIA", text: "Онлайн", badge: "2", icon: BadgeCheck, accent: true, href: "/support" },
    { title: "Оплата замовлення #128734", text: "5 хв тому", icon: ShoppingBag, href: "/messages" },
    { title: "Перевірка лоту #125671", text: "18 хв тому", icon: MessageCircle, href: "/messages" }
  ];

  return (
    <section className="rounded-lg border border-line bg-card p-5 shadow-soft">
      <div className="mb-4 flex items-center gap-2">
        <h2 className="text-base font-black text-ink">Останні чати</h2>
        <span className="rounded-full bg-panel px-2 py-0.5 text-xs font-bold text-ink">3</span>
      </div>
      <div className="space-y-2">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.title} type="button" className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition hover:bg-panel" onClick={() => onOpen(item.href)}>
              <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${item.accent ? "bg-brand/15 text-brand" : "bg-panel text-muted"}`}>
                <Icon className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold text-ink">{item.title}</span>
                <span className={`block truncate text-xs ${item.accent ? "text-emerald-400" : "text-muted"}`}>{item.text}</span>
              </span>
              {item.badge ? <span className="grid h-6 min-w-6 place-items-center rounded-full bg-action px-1 text-xs font-black text-stone-950">{item.badge}</span> : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function SupportWidget({ onOpen }: { onOpen: () => void }) {
  return (
    <section className="relative overflow-hidden rounded-lg border border-brand/20 bg-card p-5 shadow-soft">
      <div className="absolute -right-8 top-5 h-28 w-28 rounded-full border-[10px] border-brand/55" />
      <div className="absolute right-8 top-10 grid h-16 w-16 place-items-center rounded-full bg-brand/10 text-brand">
        <Headphones className="h-9 w-9" />
      </div>
      <div className="relative z-10 max-w-[210px]">
        <h2 className="text-lg font-black text-ink">Ми завжди на зв'язку</h2>
        <p className="mt-2 text-sm leading-6 text-muted">Наша підтримка допоможе з будь-яким питанням</p>
        <button className="mt-4 rounded-lg border border-brand/70 px-4 py-2 text-sm font-black text-brand transition hover:bg-brand hover:text-stone-950" onClick={onOpen}>
          Написати в підтримку
        </button>
      </div>
    </section>
  );
}

function pickTiles(games: Game[], pattern: RegExp, fallback: CategoryTile[]) {
  const matched = games.filter((item) => pattern.test(`${item.slug} ${item.name} ${item.publisher ?? ""}`)).slice(0, 8);
  const source = matched.length >= 3 ? matched : fallback;
  return source.map((item) => ({
    id: item.id,
    slug: item.slug,
    name: item.name,
    publisher: item.publisher,
    lotCount: item.lotCount
  }));
}

function mergeTiles(primary: CategoryTile[], required: CategoryTile[]) {
  const bySlug = new Map<string, CategoryTile>();
  for (const item of primary) bySlug.set(item.slug, item);
  for (const item of required) {
    if (!bySlug.has(item.slug)) bySlug.set(item.slug, item);
  }
  return Array.from(bySlug.values());
}

function gameTileTheme(slug: string, name: string): GameTileThemeConfig {
  const blueGlow = "bg-sky-400/10 shadow-[inset_0_0_34px_rgba(56,189,248,0.24),0_0_26px_rgba(56,189,248,0.18)]";
  const goldGlow = "bg-amber-400/10 shadow-[inset_0_0_34px_rgba(251,191,36,0.22),0_0_26px_rgba(251,191,36,0.16)]";
  const greenGlow = "bg-emerald-400/10 shadow-[inset_0_0_34px_rgba(74,222,128,0.22),0_0_26px_rgba(74,222,128,0.16)]";
  const redGlow = "bg-orange-400/10 shadow-[inset_0_0_34px_rgba(249,115,22,0.22),0_0_26px_rgba(249,115,22,0.16)]";
  const steelGlow = "bg-white/[0.06] shadow-[inset_0_0_34px_rgba(255,255,255,0.16),0_0_26px_rgba(148,163,184,0.12)]";

  const themes: Record<string, GameTileThemeConfig> = {
    pubg: { gradient: "from-[#090705] via-[#3a210c] to-[#0a0c10]", panel: "bg-amber-400/25", border: "border-amber-300/20 hover:border-amber-200/40", glow: goldGlow, logo: "PUBG MOBILE", caption: "Battle royale", scene: "shooter" },
    "free-fire": { gradient: "from-[#070503] via-[#3b1908] to-[#100804]", panel: "bg-orange-400/30", border: "border-orange-300/20 hover:border-orange-200/40", glow: redGlow, logo: "FREE FIRE", caption: "Garena", scene: "shooter" },
    "genshin-impact": { gradient: "from-[#080604] via-[#4a3212] to-[#0d1015]", panel: "bg-amber-200/25", border: "border-amber-200/25 hover:border-amber-100/45", glow: goldGlow, logo: "GENSHIN", caption: "Impact", scene: "fantasy" },
    "brawl-stars": { gradient: "from-[#110605] via-[#5b1d08] to-[#1b0705]", panel: "bg-yellow-300/30", border: "border-orange-300/25 hover:border-yellow-200/50", glow: redGlow, logo: "BRAWL STARS", caption: "Supercell", scene: "brawler" },
    "clash-of-clans": { gradient: "from-[#160705] via-[#5b2409] to-[#100804]", panel: "bg-amber-300/25", border: "border-amber-300/25 hover:border-yellow-200/45", glow: goldGlow, logo: "CLASH", caption: "of Clans", scene: "royal" },
    "clash-royale": { gradient: "from-[#110807] via-[#5a2a08] to-[#071225]", panel: "bg-amber-300/30", border: "border-amber-300/25 hover:border-yellow-200/45", glow: goldGlow, logo: "CLASH ROYALE", caption: "Arena cards", scene: "royal" },
    "mobile-legends": { gradient: "from-[#080605] via-[#54300b] to-[#071730]", panel: "bg-blue-300/25", border: "border-amber-200/25 hover:border-blue-200/45", glow: blueGlow, logo: "MOBILE LEGENDS", caption: "Moonton", scene: "fantasy" },
    "league-wild-rift": { gradient: "from-[#090605] via-[#54300d] to-[#06142a]", panel: "bg-cyan-300/25", border: "border-amber-200/25 hover:border-cyan-200/45", glow: blueGlow, logo: "WILD RIFT", caption: "League of Legends", scene: "fantasy" },
    roblox: { gradient: "from-[#0b0b0f] via-[#331015] to-[#0a0c12]", panel: "bg-red-400/25", border: "border-red-300/20 hover:border-red-200/40", glow: redGlow, logo: "ROBLOX", caption: "Accounts", scene: "brawler" },
    "standoff-2": { gradient: "from-[#080604] via-[#3f1d07] to-[#090909]", panel: "bg-orange-300/25", border: "border-orange-300/25 hover:border-amber-200/45", glow: redGlow, logo: "STANDOFF 2", caption: "Shooter", scene: "shooter" },
    "arena-breakout": { gradient: "from-[#080807] via-[#312719] to-[#090909]", panel: "bg-stone-300/20", border: "border-stone-300/20 hover:border-amber-100/35", glow: steelGlow, logo: "ARENA BREAKOUT", caption: "Tactical FPS", scene: "shooter" },
    "call-of-duty-mobile": { gradient: "from-[#090705] via-[#3b1e0a] to-[#0a0a0a]", panel: "bg-yellow-300/25", border: "border-amber-300/25 hover:border-yellow-200/45", glow: goldGlow, logo: "COD MOBILE", caption: "Activision", scene: "shooter" },
    steam: { gradient: "from-[#050b12] via-[#09233a] to-[#03070d]", panel: "bg-sky-300/20", border: "border-sky-300/25 hover:border-sky-200/50", glow: blueGlow, logo: "Steam", caption: "PC platform", scene: "platform" },
    "epic-games": { gradient: "from-[#090909] via-[#24272d] to-[#030303]", panel: "bg-white/15", border: "border-white/20 hover:border-white/45", glow: steelGlow, logo: "Epic Games", caption: "Store", scene: "platform" },
    playstation: { gradient: "from-[#050912] via-[#0b2a63] to-[#030816]", panel: "bg-blue-300/25", border: "border-blue-300/25 hover:border-blue-200/55", glow: blueGlow, logo: "PlayStation", caption: "Console", scene: "platform" },
    xbox: { gradient: "from-[#050b08] via-[#0f4a18] to-[#020805]", panel: "bg-green-300/25", border: "border-green-300/25 hover:border-green-200/55", glow: greenGlow, logo: "Xbox", caption: "Console", scene: "platform" },
    "battle-net": { gradient: "from-[#030812] via-[#082d55] to-[#02050a]", panel: "bg-sky-300/25", border: "border-sky-300/25 hover:border-sky-200/55", glow: blueGlow, logo: "BATTLE.NET", caption: "Blizzard", scene: "platform" },
    nintendo: { gradient: "from-[#130505] via-[#621212] to-[#070303]", panel: "bg-red-300/25", border: "border-red-300/25 hover:border-red-200/50", glow: redGlow, logo: "Nintendo", caption: "Console", scene: "platform" },
    "ubisoft-connect": { gradient: "from-[#050913] via-[#0b3568] to-[#030812]", panel: "bg-cyan-300/20", border: "border-cyan-300/20 hover:border-cyan-200/45", glow: blueGlow, logo: "Ubisoft", caption: "Connect", scene: "platform" },
    "ea-app": { gradient: "from-[#050913] via-[#073a58] to-[#030812]", panel: "bg-cyan-300/20", border: "border-cyan-300/20 hover:border-cyan-200/45", glow: blueGlow, logo: "EA App", caption: "PC platform", scene: "platform" },
    rockstar: { gradient: "from-[#100904] via-[#5f2b09] to-[#050505]", panel: "bg-yellow-300/25", border: "border-yellow-300/25 hover:border-yellow-200/50", glow: goldGlow, logo: "Rockstar", caption: "Launcher", scene: "platform" },
    gog: { gradient: "from-[#090718] via-[#2e1b65] to-[#05030d]", panel: "bg-violet-300/20", border: "border-violet-300/20 hover:border-violet-200/45", glow: "bg-violet-400/10 shadow-[inset_0_0_34px_rgba(167,139,250,0.22),0_0_26px_rgba(167,139,250,0.14)]", logo: "GOG", caption: "DRM-free", scene: "platform" },
    cs2: { gradient: "from-[#090705] via-[#42210b] to-[#080a10]", panel: "bg-orange-300/25", border: "border-orange-300/25 hover:border-orange-200/45", glow: redGlow, logo: "CS2", caption: "Valve", scene: "shooter" },
    "dota-2": { gradient: "from-[#100506] via-[#3d0e10] to-[#050303]", panel: "bg-red-300/20", border: "border-red-300/20 hover:border-red-200/40", glow: redGlow, logo: "DOTA 2", caption: "Valve", scene: "fantasy" },
    valorant: { gradient: "from-[#100507] via-[#52111e] to-[#07070d]", panel: "bg-rose-300/20", border: "border-rose-300/20 hover:border-rose-200/40", glow: redGlow, logo: "VALORANT", caption: "Riot Games", scene: "shooter" },
    rust: { gradient: "from-[#0b0604] via-[#41200d] to-[#060505]", panel: "bg-orange-300/20", border: "border-orange-300/20 hover:border-orange-200/40", glow: redGlow, logo: "RUST", caption: "Survival", scene: "shooter" },
    "call-of-duty": { gradient: "from-[#080706] via-[#3c2816] to-[#050505]", panel: "bg-stone-300/20", border: "border-stone-300/20 hover:border-amber-100/35", glow: steelGlow, logo: "WARZONE", caption: "Call of Duty", scene: "shooter" },
    fortnite: { gradient: "from-[#071120] via-[#24327a] to-[#0a0615]", panel: "bg-sky-300/20", border: "border-sky-300/20 hover:border-sky-200/40", glow: blueGlow, logo: "FORTNITE", caption: "Epic Games", scene: "brawler" },
    "gta-online": { gradient: "from-[#071005] via-[#285b17] to-[#040804]", panel: "bg-lime-300/20", border: "border-lime-300/20 hover:border-lime-200/40", glow: greenGlow, logo: "GTA V", caption: "Rockstar", scene: "shooter" },
    "apex-legends": { gradient: "from-[#120605] via-[#5c1812] to-[#050303]", panel: "bg-red-300/20", border: "border-red-300/20 hover:border-red-200/40", glow: redGlow, logo: "APEX", caption: "Legends", scene: "shooter" },
    minecraft: { gradient: "from-[#071005] via-[#1d5b22] to-[#080604]", panel: "bg-lime-300/20", border: "border-lime-300/20 hover:border-lime-200/40", glow: greenGlow, logo: "MINECRAFT", caption: "Mojang", scene: "fantasy" },
    "league-of-legends": { gradient: "from-[#080604] via-[#4a2d0b] to-[#07132a]", panel: "bg-yellow-300/20", border: "border-amber-200/20 hover:border-yellow-100/40", glow: goldGlow, logo: "LEAGUE", caption: "of Legends", scene: "fantasy" }
  };

  const theme = themes[slug];
  if (theme) return { ...theme, image: `/assets/game-cards/${slug}.svg` };

  return {
    gradient: "from-slate-800 via-slate-950 to-black",
    panel: "bg-white/15",
    border: "border-white/10 hover:border-white/25",
    glow: steelGlow,
    logo: name,
    caption: "Marketplace",
    scene: "platform"
  };
}
