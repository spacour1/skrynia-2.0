"use client";

import { useRouter } from "@/lib/navigation";
import type { FormEvent } from "react";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
  Coins,
  FileText,
  Heart,
  KeyRound,
  MessageCircle,
  PackageCheck,
  Send,
  ShieldCheck,
  ShoppingBag,
  Star,
  Swords,
  Trophy,
  Users,
  Wrench,
  Zap,
  type LucideIcon
} from "lucide-react";
import { GameIcon } from "../../components/GameIcon";
import { apiFetch, money, type Game, type Product } from "../../lib/api";
import { firstProductMedia } from "../../lib/product-media";
import { useAuth } from "../../lib/auth-store";
import { SECTION_PATTERNS, getGameTileTheme, type CategoryTile, type GameTileThemeConfig } from "../../lib/game-catalog";
import { useI18n } from "../../lib/i18n";

type ChatMessage = {
  id: string;
  name: string;
  text: string;
  time: string;
  avatar: string;
};

export default function HomePage() {
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const { t } = useI18n();

  const games = useQuery({
    queryKey: ["games"],
    queryFn: () => apiFetch<{ games: Game[] }>("/marketplace/games")
  });

  // Homepage rows are built only from catalog-builder data: games the admin left visible
  // (showOnHomepage), curated "popular" flags first, real lot counts, no seeded lists.
  const gamesList = (games.data?.games ?? []).filter((game) => game.showOnHomepage !== false);
  const curatedPopular = gamesList.filter((game) => game.isPopular);
  const popularGames = tilesFromGames(
    curatedPopular.length ? curatedPopular : [...gamesList].sort((a, b) => (b.lotCount ?? 0) - (a.lotCount ?? 0)).slice(0, 10)
  );
  const platformGames = tilesFromGames(gamesList.filter((game) => SECTION_PATTERNS.platform.test(`${game.slug} ${game.name} ${game.publisher ?? ""}`)));

  function selectGame(slug: string) {
    router.push(`/games/${slug}`);
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_360px]">
      <main className="min-w-0 space-y-6 pb-4">
        <Hero />

        <section id="game-catalog" className="space-y-6 scroll-mt-28">
          {games.isLoading ? (
            <RowSkeleton />
          ) : (
            <>
              <CategoryCarousel title={t("home.sections.popular")} items={popularGames} onSelect={selectGame} />
              {platformGames.length ? <PlatformsRow items={platformGames} onSelect={selectGame} /> : null}
            </>
          )}
          <CategoriesRow />
          <FreshOffers onOpen={(id) => router.push(`/products/${id}`)} />
        </section>
      </main>

      <aside className="space-y-4 xl:sticky xl:top-[106px] xl:self-start">
        <GeneralChatWidget />
        <SupportWidget onOpen={() => router.push("/support")} />
        <RecentChatsWidget onOpen={(href) => router.push(user ? href : "/login")} />
        <TrustWidget />
      </aside>
    </div>
  );
}

function tilesFromGames(games: Game[]): CategoryTile[] {
  return games.map((game) => ({
    id: game.id,
    slug: game.slug,
    name: game.name,
    publisher: game.publisher,
    lotCount: game.lotCount,
    image: game.banner ?? game.backgroundImage ?? undefined
  }));
}

function RowSkeleton() {
  return (
    <div className="space-y-2.5">
      <div className="h-6 w-40 animate-pulse rounded bg-panel" />
      <div className="flex gap-3">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="aspect-[2.42/1] flex-1 animate-pulse rounded-lg bg-panel" />
        ))}
      </div>
    </div>
  );
}

function Hero() {
  const { t } = useI18n();
  const benefits = [
    { title: t("home.benefits.safeTitle"), text: t("home.benefits.safeText"), icon: PackageCheck },
    { title: t("home.benefits.fastTitle"), text: t("home.benefits.fastText"), icon: Zap },
    { title: t("home.benefits.reliableTitle"), text: t("home.benefits.reliableText"), icon: ShieldCheck },
    { title: t("home.benefits.choiceTitle"), text: t("home.benefits.choiceText"), icon: Trophy }
  ];

  return (
    <section className="relative min-h-[300px] overflow-hidden rounded-2xl border border-line shadow-soft">
      <img
        className="absolute inset-0 h-full w-full object-cover object-[68%_center]"
        src="/assets/home/header/main-header.webp"
        alt=""
        fetchPriority="high"
        draggable={false}
      />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(5,11,24,0.97)_0%,rgba(5,11,24,0.86)_36%,rgba(7,17,31,0.42)_66%,rgba(5,11,24,0.6)_100%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_74%_38%,rgba(183,255,26,0.16),transparent_52%)]" />
      <img
        className="pointer-events-none absolute right-[4%] top-6 hidden h-[58%] drop-shadow-[0_18px_44px_rgba(183,255,26,0.22)] md:block"
        src="/brand/keepgame-mascot.svg"
        alt=""
        draggable={false}
      />

      <div className="relative z-10 flex min-h-[300px] flex-col justify-between px-6 pb-5 pt-8 sm:px-10 lg:px-12">
        <div>
          <h1 className="max-w-[560px] text-[28px] font-black leading-[1.1] tracking-normal text-white md:text-[36px] xl:text-[40px]">
            {t("home.hero.titleLine1")}
            <span className="block text-brand">{t("home.hero.titleLine2")}</span>
            <span className="block">{t("home.hero.titleLine3")}</span>
          </h1>
          <p className="mt-3 max-w-[420px] text-sm text-slate-300/85 md:text-base">{t("home.hero.subtitle")}</p>
        </div>

        <div className="mt-6 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          {benefits.map((item) => (
            <Benefit key={item.title} {...item} />
          ))}
        </div>

        <div className="mt-4 flex items-center justify-center gap-1.5">
          {[0, 1, 2, 3].map((dot) => (
            <span key={dot} className={`h-1.5 rounded-full transition ${dot === 0 ? "w-5 bg-brand" : "w-1.5 bg-white/25"}`} />
          ))}
        </div>
      </div>

      <button className="absolute left-3 top-1/2 z-20 hidden h-9 w-9 -translate-y-1/2 place-items-center rounded-full border border-white/10 bg-black/35 text-white/70 backdrop-blur transition hover:text-brand sm:grid" aria-label={t("home.carousel.back")}>
        <ChevronLeft className="h-5 w-5" />
      </button>
      <button className="absolute right-3 top-1/2 z-20 hidden h-9 w-9 -translate-y-1/2 place-items-center rounded-full border border-white/10 bg-black/35 text-white/70 backdrop-blur transition hover:text-brand sm:grid" aria-label={t("home.carousel.forward")}>
        <ChevronRight className="h-5 w-5" />
      </button>
    </section>
  );
}

function Benefit({ title, text, icon: Icon }: { title: string; text: string; icon: LucideIcon }) {
  return (
    <article className="flex min-w-0 items-center gap-2.5 rounded-xl border border-white/10 bg-black/35 px-3 py-2 backdrop-blur-sm">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand/15 text-brand ring-1 ring-brand/30">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-black text-white">{title}</span>
        <span className="mt-0.5 block truncate text-[11px] text-slate-300/80">{text}</span>
      </span>
    </article>
  );
}

function CategoryCarousel({ title, items, onSelect, compact }: { title: string; items: CategoryTile[]; onSelect: (slug: string) => void; compact?: boolean }) {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);

  function scroll(direction: number) {
    const viewport = scrollRef.current;
    if (!viewport) return;
    viewport.scrollBy({ left: direction * viewport.clientWidth, behavior: "smooth" });
  }

  return (
    <section className="group w-full max-w-full space-y-2.5">
      <div className="flex max-w-full items-center justify-between gap-3">
        <button className="inline-flex items-center gap-2 text-left text-base font-black text-white transition hover:text-brand md:text-lg" onClick={() => scroll(1)}>
          {title}
          <ChevronRight className="h-4 w-4 text-brand" />
        </button>
        <div className="hidden gap-2 opacity-30 transition-opacity group-hover:opacity-100 sm:flex">
          <button className="grid h-8 w-8 place-items-center rounded-lg bg-panel/25 text-muted hover:bg-panel/70 hover:text-brand" onClick={() => scroll(-1)} aria-label={t("home.carousel.back")}>
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button className="grid h-8 w-8 place-items-center rounded-lg bg-panel/25 text-muted hover:bg-panel/70 hover:text-brand" onClick={() => scroll(1)} aria-label={t("home.carousel.forward")}>
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div ref={scrollRef} className="flex max-w-full snap-x snap-mandatory gap-3 overflow-x-auto pb-1.5 sm:overflow-x-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((item) => {
          const theme = getGameTileTheme(item.slug, item.name);
          const tile = item.image ? { ...theme, image: item.image } : theme;
          return (
            <button
              key={item.id}
              className="group/tile relative aspect-[2.42/1] basis-[78%] shrink-0 snap-start overflow-hidden rounded-lg bg-[#03070d] text-left shadow-[0_12px_26px_rgba(0,0,0,0.24)] transition duration-300 hover:-translate-y-0.5 hover:shadow-lift sm:basis-[calc((100%_-_24px)/3)] lg:basis-[calc((100%_-_48px)/5)]"
              onClick={() => onSelect(item.slug)}
              title={item.name}
            >
              <GameTileBackdrop name={item.name} slug={item.slug} tile={tile} compact={Boolean(compact)} />
              {!tile.image ? (
                <div className="relative z-10 flex h-full items-center gap-3 px-3">
                  <span className={`${compact ? "h-10 w-10" : "h-11 w-11"} relative grid shrink-0 place-items-center rounded-full border border-white/10 bg-black/35 shadow-[0_0_24px_rgba(255,255,255,0.08)] backdrop-blur-sm`}>
                    <span className={`absolute inset-0 rounded-full ${tile.glow}`} />
                    <GameIcon name={item.name} slug={item.slug} className={`${compact ? "h-7 w-7" : "h-8 w-8"} rounded-xl ring-1 ring-white/25`} />
                  </span>
                  <span className="min-w-0 flex-1 pr-7">
                    <span className={`block truncate font-black uppercase leading-none tracking-normal text-white drop-shadow-[0_3px_14px_rgba(0,0,0,0.72)] ${compact ? "text-sm" : "text-base"}`}>
                      {tile.logo}
                    </span>
                    <span className="mt-1 block truncate text-[9px] font-semibold uppercase tracking-normal text-white/68">{tile.caption}</span>
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
      {tile.image ? <img className="absolute inset-0 h-full w-full scale-[1.08] object-cover transition duration-500 group-hover/tile:scale-[1.12]" src={tile.image} alt="" loading="lazy" draggable={false} /> : null}
      {!tile.image ? <div className={`absolute inset-0 bg-gradient-to-br ${tile.gradient}`} /> : null}
      <div className={`absolute inset-0 ${tile.image ? "bg-[linear-gradient(90deg,rgba(2,6,12,0.08),rgba(2,6,12,0)_48%,rgba(2,6,12,0.08))]" : "bg-[linear-gradient(90deg,rgba(2,6,12,0.95)_0%,rgba(2,6,12,0.62)_45%,rgba(2,6,12,0.18)_72%,rgba(2,6,12,0.72)_100%),radial-gradient(circle_at_45%_88%,rgba(255,255,255,0.16),transparent_34%),linear-gradient(145deg,rgba(255,255,255,0.12)_0%,transparent_26%,rgba(0,0,0,0.38)_76%)]"}`} />
      {!tile.image ? <div className={`absolute -bottom-8 left-[18%] h-20 w-[62%] rounded-full blur-2xl ${tile.panel}`} /> : null}
      {!tile.image ? <div className="absolute inset-x-4 bottom-0 h-px bg-white/12" /> : null}
      {!tile.image ? <div className={`absolute inset-0 rounded-xl opacity-80 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.045)] ${tile.glow}`} /> : null}
      {!tile.image ? (
        <>
          <div className="absolute left-7 top-3 h-2 w-1 rounded-full bg-white/35 blur-[1px]" />
          <div className="absolute left-[48%] top-5 h-1.5 w-1.5 rounded-full bg-white/30 blur-[1px]" />
          {tile.scene === "platform" ? <PlatformTileScene slug={slug} tile={tile} compact={compact} /> : <GameTileScene slug={slug} tile={tile} compact={compact} />}
          <GameIcon name={name} slug={slug} className={`${compact ? "h-[70px] w-[70px]" : "h-[78px] w-[78px]"} absolute -right-5 -top-5 opacity-[0.16] blur-[0.3px] transition duration-300 group-hover/tile:scale-110 group-hover/tile:opacity-[0.24]`} />
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
    <div className="absolute inset-y-2 right-2 w-[48%] opacity-70 transition duration-300 group-hover/tile:opacity-90">
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
    <div className="absolute inset-y-0 right-0 w-[48%] overflow-hidden opacity-[0.82] transition duration-300 group-hover/tile:opacity-100">
      <div className={`absolute bottom-0 right-5 ${figureHeight} w-16 rounded-t-[42px] bg-gradient-to-b ${isFantasy ? "from-amber-200/70 via-orange-700/40 to-black/70" : isBrawler ? "from-yellow-300/70 via-orange-700/40 to-black/75" : "from-zinc-200/50 via-stone-700/40 to-black/80"} shadow-[0_0_32px_rgba(0,0,0,0.45)]`} />
      <div className={`absolute right-4 top-4 h-11 w-16 rounded-full ${isFantasy ? "bg-amber-200/25" : isBrawler ? "bg-orange-300/20" : "bg-stone-200/15"} blur-sm`} />
      <div className={`absolute bottom-0 right-0 h-16 w-[92%] bg-gradient-to-t ${isFantasy ? "from-amber-600/20" : isBrawler ? "from-orange-600/25" : "from-stone-500/20"} to-transparent`} />
      <div className={`absolute bottom-2 right-8 h-7 w-24 -rotate-12 rounded-full ${tile.panel} blur-[1px]`} />
      {tile.scene === "shooter" ? <span className="absolute bottom-5 right-7 h-3 w-24 -rotate-[22deg] rounded-full bg-zinc-200/25 shadow-[0_0_18px_rgba(251,191,36,0.18)]" /> : null}
      {slug === "pubg" || slug === "pubg-mobile" || slug === "standoff-2" || slug === "arena-breakout" || slug === "call-of-duty-mobile" ? (
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

function SectionHeader({ title }: { title: string }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="inline-flex items-center gap-2 text-base font-black text-white md:text-lg">
        {title}
        <ChevronRight className="h-4 w-4 text-brand" />
      </h2>
      <a href="#game-catalog" className="text-xs font-bold text-muted transition hover:text-brand">
        {t("home.viewAll")}
      </a>
    </div>
  );
}

function PlatformsRow({ items, onSelect }: { items: CategoryTile[]; onSelect: (slug: string) => void }) {
  const { t } = useI18n();
  return (
    <section className="space-y-2.5">
      <SectionHeader title={t("home.sections.platform")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {items.slice(0, 5).map((item) => (
          <button
            key={item.id}
            className="flex items-center gap-3 rounded-xl border border-line bg-card p-3 text-left shadow-soft transition hover:-translate-y-0.5 hover:border-brand/60"
            onClick={() => onSelect(item.slug)}
          >
            <GameIcon name={item.name} slug={item.slug} className="h-10 w-10 shrink-0 rounded-lg" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-black text-ink">{item.name}</span>
              <span className="block truncate text-xs text-muted">
                {(item.lotCount ?? 0).toLocaleString("uk-UA")} {t("home.itemsLabel")}
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

type MarketCategory = { id: string; slug: string; name: string; activeProductCount: number };

// Maps DB category slugs to the fixed homepage i18n labels; unknown slugs fall back to
// the category's own name from the API.
const CATEGORY_LABEL_KEYS: Record<string, string> = {
  accounts: "accounts",
  items: "items",
  games: "keys",
  keys: "keys",
  currency: "currency",
  boosting: "services",
  services: "services",
  "digital-services": "digital"
};

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  accounts: Users,
  items: Swords,
  games: KeyRound,
  keys: KeyRound,
  currency: Coins,
  boosting: Wrench,
  services: Wrench,
  "digital-services": FileText
};

function CategoriesRow() {
  const { t } = useI18n();
  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: () => apiFetch<{ categories: MarketCategory[] }>("/marketplace/categories")
  });
  const list = categories.data?.categories ?? [];

  if (categories.isLoading) return <RowSkeleton />;
  if (!list.length) return null;

  return (
    <section className="space-y-2.5">
      <SectionHeader title={t("home.sections.categories")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {list.map((category) => {
          const Icon = CATEGORY_ICONS[category.slug] ?? Swords;
          const labelKey = CATEGORY_LABEL_KEYS[category.slug];
          return (
            <a
              key={category.id}
              href="#game-catalog"
              className="flex items-center gap-3 rounded-xl border border-line bg-card p-3 shadow-soft transition hover:-translate-y-0.5 hover:border-brand/60"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-brand/40 bg-brand/10 text-brand">
                <Icon className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-black text-ink">{labelKey ? t(`home.categories.${labelKey}`) : category.name}</span>
                <span className="block truncate text-xs text-muted">
                  {category.activeProductCount.toLocaleString("uk-UA")} {t("home.itemsLabel")}
                </span>
              </span>
            </a>
          );
        })}
      </div>
    </section>
  );
}

type OfferItem = {
  id: string;
  title: string;
  priceCents: number;
  currency: string;
  top: boolean;
  image: string | null;
  seller: string;
  rating: number;
};

function FreshOffers({ onOpen }: { onOpen: (id: string) => void }) {
  const { t } = useI18n();
  const products = useQuery({
    queryKey: ["home-fresh-products"],
    queryFn: () => apiFetch<{ products: Product[]; total: number }>("/marketplace/products?limit=6")
  });

  const offers: OfferItem[] = (products.data?.products ?? []).slice(0, 6).map((product) => ({
    id: product.id,
    title: product.title,
    priceCents: Number(product.priceCents),
    currency: product.currency,
    top: Boolean(product.isHot),
    image: firstProductMedia(product),
    seller: product.sellerDisplayName ?? "",
    rating: Number(product.sellerRating ?? 0)
  }));

  if (products.isLoading) return <RowSkeleton />;

  if (!offers.length) {
    return (
      <section className="space-y-2.5">
        <SectionHeader title={t("home.sections.fresh")} />
        <div className="grid min-h-[120px] place-items-center rounded-xl border border-line bg-card p-6 text-center shadow-soft">
          <p className="max-w-[360px] text-sm leading-6 text-muted">{products.isError ? t("home.freshError") : t("home.freshEmpty")}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-2.5">
      <SectionHeader title={t("home.sections.fresh")} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {offers.map((offer) => (
          <article
            key={offer.id}
            className="group cursor-pointer overflow-hidden rounded-xl border border-line bg-card shadow-soft transition hover:-translate-y-0.5 hover:border-brand/60"
            onClick={() => onOpen(offer.id)}
          >
            <div className="relative aspect-[16/10] overflow-hidden">
              {offer.image ? (
                <img className="h-full w-full object-cover transition duration-300 group-hover:scale-105" src={offer.image} alt="" loading="lazy" draggable={false} />
              ) : (
                <div className="h-full w-full bg-gradient-to-br from-slate-700/50 via-slate-900/70 to-black" />
              )}
              <span className={`absolute left-2 top-2 rounded-md px-2 py-0.5 text-[10px] font-black uppercase ${offer.top ? "bg-action text-stone-950" : "bg-brand text-stone-950"}`}>
                {offer.top ? t("home.badges.top") : t("home.badges.new")}
              </span>
              <span className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-black/45 text-white/80 backdrop-blur transition hover:text-brand">
                <Heart className="h-3.5 w-3.5" />
              </span>
            </div>
            <div className="p-3">
              <h3 className="line-clamp-1 text-sm font-bold text-ink transition group-hover:text-brand">{offer.title}</h3>
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <p className="text-sm font-black text-brand">{money(offer.priceCents, offer.currency)}</p>
                {offer.seller ? (
                  <p className="flex min-w-0 items-center gap-1 text-xs text-muted">
                    <Star className="h-3 w-3 shrink-0 fill-action text-action" />
                    {offer.rating.toFixed(1)}
                    <span className="truncate">· {offer.seller}</span>
                  </p>
                ) : null}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function TrustWidget() {
  const { t } = useI18n();
  const items = [
    { title: t("home.benefits.safeTitle"), text: t("home.benefits.safeText"), icon: PackageCheck },
    { title: t("home.benefits.fastTitle"), text: t("home.benefits.fastText"), icon: Zap },
    { title: t("home.benefits.reliableTitle"), text: t("home.benefits.reliableText"), icon: ShieldCheck }
  ];
  return (
    <section className="rounded-lg border border-brand/30 bg-card p-4 shadow-soft">
      <div className="grid grid-cols-3 gap-2 text-center">
        {items.map(({ title, text, icon: Icon }) => (
          <div key={title} className="min-w-0">
            <span className="mx-auto grid h-9 w-9 place-items-center rounded-lg border border-brand/40 bg-brand/10 text-brand">
              <Icon className="h-4 w-4" />
            </span>
            <p className="mt-2 truncate text-xs font-black text-ink">{title}</p>
            <p className="mt-0.5 text-[10px] leading-4 text-muted">{text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function GeneralChatWidget() {
  const { t } = useI18n();
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    { id: "m1", name: "ShadowHunter", text: t("home.chat.m1"), time: "16:52", avatar: "/avatars/keyforge-market.svg" },
    { id: "m2", name: "Kira", text: t("home.chat.m2"), time: "16:53", avatar: "/avatars/nova-accounts.svg" },
    { id: "m3", name: "NecX", text: t("home.chat.m3"), time: "16:54", avatar: "/avatars/pixel-boost.svg" },
    { id: "m4", name: "GameLord", text: t("home.chat.m4"), time: "16:55", avatar: "/avatars/raid-supply.svg" },
    { id: "m5", name: "Viper", text: t("home.chat.m5"), time: "16:55", avatar: "/avatars/nova-accounts.svg" }
  ]);
  const [text, setText] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    setMessages((current) => [
      ...current.slice(-5),
      {
        id: `local-${Date.now()}`,
        name: t("home.chat.you"),
        text: value,
        time: new Date().toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" }),
        avatar: "/avatars/raid-supply.svg"
      }
    ]);
    setText("");
  }

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-card shadow-soft">
      <div className="flex items-center justify-between gap-3 px-5 py-4">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-black text-ink">{t("home.chat.title")}</h2>
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
          placeholder={t("home.chat.placeholder")}
        />
        <button className="grid w-12 place-items-center bg-panel/45 text-brand transition hover:bg-brand hover:text-stone-950 disabled:text-muted" disabled={!text.trim()} aria-label={t("home.chat.send")}>
          <Send className="h-5 w-5" />
        </button>
      </form>
    </section>
  );
}

function RecentChatsWidget({ onOpen }: { onOpen: (href: string) => void }) {
  const { t } = useI18n();
  const items = [
    { title: t("home.recentChats.support"), text: t("home.recentChats.online"), badge: "2", icon: BadgeCheck, accent: true, href: "/support" },
    { title: t("home.recentChats.orderPayment"), text: t("home.recentChats.minutesAgo"), icon: ShoppingBag, href: "/messages" },
    { title: t("home.recentChats.lotCheck"), text: t("home.recentChats.minutesAgo18"), icon: MessageCircle, href: "/messages" }
  ];

  return (
    <section className="rounded-lg border border-line bg-card p-5 shadow-soft">
      <div className="mb-4 flex items-center gap-2">
        <h2 className="text-base font-black text-ink">{t("home.recentChats.title")}</h2>
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
  const { t } = useI18n();
  return (
    <section className="relative min-h-[150px] overflow-hidden rounded-lg border border-brand/50 bg-card p-5 shadow-soft">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(115deg,rgba(183,255,26,0.16),rgba(13,23,40,0.2)_55%,rgba(183,255,26,0.08))]" />
      <img className="pointer-events-none absolute -right-3 bottom-0 h-[120px]" src="/brand/keepgame-mascot.svg" alt="" draggable={false} />
      <div className="relative z-10 max-w-[200px]">
        <h2 className="text-lg font-black text-ink">{t("home.support.title")}</h2>
        <p className="mt-1.5 text-sm leading-5 text-muted">{t("home.support.text")}</p>
        <button className="mt-3.5 rounded-lg bg-brand px-4 py-2 text-sm font-black text-stone-950 transition hover:brightness-110" onClick={onOpen}>
          {t("home.support.button")}
        </button>
      </div>
    </section>
  );
}

