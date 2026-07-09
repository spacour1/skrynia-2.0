"use client";

import { useRouter } from "@/lib/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Coins,
  FileText,
  Heart,
  KeyRound,
  MessageCircle,
  PackageCheck,
  ShieldCheck,
  Star,
  Swords,
  Trophy,
  Users,
  Wrench,
  Zap,
  type LucideIcon
} from "lucide-react";
import { useRef } from "react";
import { GameIcon } from "../../components/GameIcon";
import { apiFetch, money, type ConversationGroup, type Game, type Product } from "../../lib/api";
import { firstProductMedia } from "../../lib/product-media";
import { useAuth } from "../../lib/auth-store";
import { buildSectionTiles, getGameTileTheme, type CategoryTile, type GameTileThemeConfig } from "../../lib/game-catalog";
import { useI18n } from "../../lib/i18n";

export default function HomePage() {
  const router = useRouter();
  const { t } = useI18n();

  const games = useQuery({
    queryKey: ["games"],
    queryFn: () => apiFetch<{ games: Game[] }>("/marketplace/games")
  });

  const gamesList = games.data?.games ?? [];
  const platformGames = buildSectionTiles("platform", gamesList);
  const popularGames = buildSectionTiles("mobile", gamesList);

  function selectGame(slug: string) {
    router.push(`/games/${slug}`);
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_360px]">
      <main className="min-w-0 space-y-6 pb-4">
        <Hero />

        <section id="game-catalog" className="space-y-6 scroll-mt-28">
          <CategoryCarousel title={t("home.sections.popular")} items={popularGames} onSelect={selectGame} />
          <PlatformsRow items={platformGames} onSelect={selectGame} />
          <CategoriesRow />
          <FreshOffers />
        </section>
      </main>

      <aside className="space-y-4 xl:sticky xl:top-[106px] xl:self-start">
        <RecentChatsWidget />
        <SupportWidget />
        <TrustWidget />
      </aside>
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

      <div className="relative z-10 flex min-h-[300px] flex-col justify-between px-6 pb-6 pt-8 sm:px-10 lg:px-12">
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
      </div>
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
          const tile = getGameTileTheme(item.slug, item.name);
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
              {/* Only rendered for real, backend-provided counts (see buildSectionTiles). */}
              {typeof item.lotCount === "number" && item.lotCount > 0 ? (
                <span className="block truncate text-xs text-muted">
                  {item.lotCount.toLocaleString("uk-UA")} {t("home.itemsLabel")}
                </span>
              ) : null}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function CategoriesRow() {
  const { t } = useI18n();
  const categories: { key: string; icon: LucideIcon }[] = [
    { key: "accounts", icon: Users },
    { key: "items", icon: Swords },
    { key: "keys", icon: KeyRound },
    { key: "currency", icon: Coins },
    { key: "services", icon: Wrench },
    { key: "digital", icon: FileText }
  ];

  return (
    <section className="space-y-2.5">
      <SectionHeader title={t("home.sections.categories")} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {categories.map(({ key, icon: Icon }) => (
          <a
            key={key}
            href="#game-catalog"
            className="flex items-center gap-3 rounded-xl border border-line bg-card p-3 shadow-soft transition hover:-translate-y-0.5 hover:border-brand/60"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-brand/40 bg-brand/10 text-brand">
              <Icon className="h-5 w-5" />
            </span>
            <span className="block min-w-0 truncate text-sm font-black text-ink">{t(`home.categories.${key}`)}</span>
          </a>
        ))}
      </div>
    </section>
  );
}

function FreshOffers() {
  const { t } = useI18n();
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const queryClient = useQueryClient();

  const products = useQuery({
    queryKey: ["home-fresh-products"],
    queryFn: () => apiFetch<{ products: Product[]; total: number }>("/marketplace/products?limit=6")
  });

  const favoriteIds = useQuery({
    queryKey: ["favorite-ids"],
    queryFn: () => apiFetch<{ productIds: string[] }>("/marketplace/favorites/ids"),
    enabled: Boolean(user)
  });
  const favorites = new Set(favoriteIds.data?.productIds ?? []);

  async function toggleFavorite(productId: string) {
    if (!user) {
      router.push("/login");
      return;
    }
    const liked = favorites.has(productId);
    queryClient.setQueryData<{ productIds: string[] }>(["favorite-ids"], (prev) => {
      const ids = new Set(prev?.productIds ?? []);
      if (liked) ids.delete(productId);
      else ids.add(productId);
      return { productIds: Array.from(ids) };
    });
    try {
      await apiFetch(`/marketplace/favorites/${productId}`, { method: liked ? "DELETE" : "PUT" });
    } catch {
      // Roll back the optimistic toggle if the request failed.
      queryClient.invalidateQueries({ queryKey: ["favorite-ids"] });
    }
  }

  const offers = (products.data?.products ?? []).slice(0, 6);

  return (
    <section className="space-y-2.5">
      <SectionHeader title={t("home.sections.fresh")} />
      {products.isLoading ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-[176px] animate-pulse rounded-xl border border-line bg-card shadow-soft" />
          ))}
        </div>
      ) : offers.length ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {offers.map((product) => {
            const image = firstProductMedia(product);
            const liked = favorites.has(product.id);
            const rating = Number(product.sellerRating ?? 0);
            return (
              <article
                key={product.id}
                className="group cursor-pointer overflow-hidden rounded-xl border border-line bg-card shadow-soft transition hover:-translate-y-0.5 hover:border-brand/60"
                onClick={() => router.push(`/products/${product.id}`)}
              >
                <div className="relative aspect-[16/10] overflow-hidden">
                  {image ? (
                    <img className="h-full w-full object-cover transition duration-300 group-hover:scale-105" src={image} alt="" loading="lazy" draggable={false} />
                  ) : (
                    <div className="h-full w-full bg-gradient-to-br from-slate-700/50 via-slate-900/70 to-black" />
                  )}
                  <span className={`absolute left-2 top-2 rounded-md px-2 py-0.5 text-[10px] font-black uppercase ${product.isHot ? "bg-action text-stone-950" : "bg-brand text-stone-950"}`}>
                    {product.isHot ? t("home.badges.top") : t("home.badges.new")}
                  </span>
                  <button
                    type="button"
                    className={`absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-black/45 backdrop-blur transition hover:text-brand ${liked ? "text-brand" : "text-white/80"}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleFavorite(product.id);
                    }}
                    aria-label={t("home.favorite")}
                    title={t("home.favorite")}
                  >
                    <Heart className={`h-3.5 w-3.5 ${liked ? "fill-brand" : ""}`} />
                  </button>
                </div>
                <div className="p-3">
                  <h3 className="line-clamp-1 text-sm font-bold text-ink transition group-hover:text-brand">{product.title}</h3>
                  <div className="mt-1.5 flex items-center justify-between gap-2">
                    <p className="text-sm font-black text-brand">{money(Number(product.priceCents), product.currency)}</p>
                    {product.sellerDisplayName ? (
                      <p className="flex min-w-0 items-center gap-1 text-xs text-muted">
                        {rating > 0 ? (
                          <>
                            <Star className="h-3 w-3 shrink-0 fill-action text-action" />
                            {rating.toFixed(1)}
                            <span className="truncate">· {product.sellerDisplayName}</span>
                          </>
                        ) : (
                          <span className="truncate">{product.sellerDisplayName}</span>
                        )}
                      </p>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="grid place-items-center rounded-xl border border-line bg-card px-6 py-12 text-center shadow-soft">
          <div>
            <PackageCheck className="mx-auto h-9 w-9 text-muted" />
            <p className="mt-3 text-sm font-bold text-muted">{t("home.emptyOffers")}</p>
          </div>
        </div>
      )}
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

function RecentChatsWidget() {
  const { t } = useI18n();
  const router = useRouter();
  const user = useAuth((s) => s.user);

  const conversations = useQuery({
    queryKey: ["chat-conversations-grouped"],
    queryFn: () => apiFetch<{ groups: ConversationGroup[] }>("/chat/conversations/grouped"),
    enabled: Boolean(user)
  });

  // Recent chats are inherently personal — nothing honest to show a signed-out visitor.
  if (!user) return null;

  const groups = conversations.data?.groups ?? [];
  const visible = groups.slice(0, 4);
  const totalUnread = groups.reduce((sum, group) => sum + (group.totalUnreadCount ?? 0), 0);

  return (
    <section className="rounded-lg border border-line bg-card p-5 shadow-soft">
      <div className="mb-4 flex items-center gap-2">
        <h2 className="text-base font-black text-ink">{t("home.recentChats.title")}</h2>
        {totalUnread > 0 ? (
          <span className="grid h-6 min-w-6 place-items-center rounded-full bg-action px-1 text-xs font-black text-stone-950">{totalUnread}</span>
        ) : null}
      </div>

      {conversations.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-14 animate-pulse rounded-lg bg-panel" />
          ))}
        </div>
      ) : visible.length ? (
        <div className="space-y-2">
          {visible.map((group, index) => {
            const conversationId = group.contexts[0]?.conversationId;
            return (
              <button
                key={group.peerUserId}
                type="button"
                className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition hover:bg-panel"
                onClick={() => router.push(conversationId ? `/messages?conversationId=${conversationId}` : "/messages")}
              >
                <span className={`relative grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br ${avatarGradient(index)} text-sm font-black text-white`}>
                  {group.peerAvatarUrl ? <img className="h-full w-full object-cover" src={group.peerAvatarUrl} alt="" /> : group.peerDisplayName.slice(0, 1).toUpperCase()}
                  {group.isOnline ? <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-card bg-emerald-400" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-ink">{group.peerDisplayName}</span>
                  <span className="block truncate text-xs text-muted">{group.lastMessageBody || t("home.recentChats.noMessages")}</span>
                </span>
                {group.totalUnreadCount ? (
                  <span className="grid h-6 min-w-6 place-items-center rounded-full bg-action px-1 text-xs font-black text-stone-950">{group.totalUnreadCount}</span>
                ) : (
                  <span className="shrink-0 text-[11px] text-muted">{formatTime(group.lastMessageAt)}</span>
                )}
              </button>
            );
          })}
          <button
            type="button"
            className="mt-1 w-full rounded-lg border border-line py-2 text-xs font-black text-muted transition hover:border-brand/60 hover:text-brand"
            onClick={() => router.push("/messages")}
          >
            {t("home.recentChats.viewAll")}
          </button>
        </div>
      ) : (
        <div className="grid place-items-center py-6 text-center">
          <div>
            <MessageCircle className="mx-auto h-9 w-9 text-muted" />
            <p className="mt-3 text-sm text-muted">{t("home.recentChats.empty")}</p>
            <button
              type="button"
              className="mt-3 rounded-lg bg-brand px-4 py-2 text-xs font-black text-stone-950 transition hover:brightness-110"
              onClick={() => router.push("/messages")}
            >
              {t("home.recentChats.viewAll")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function SupportWidget() {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <section className="relative min-h-[150px] overflow-hidden rounded-lg border border-brand/50 bg-card p-5 shadow-soft">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(115deg,rgba(183,255,26,0.16),rgba(13,23,40,0.2)_55%,rgba(183,255,26,0.08))]" />
      <img className="pointer-events-none absolute -right-3 bottom-0 h-[120px]" src="/brand/keepgame-mascot.svg" alt="" draggable={false} />
      <div className="relative z-10 max-w-[200px]">
        <h2 className="text-lg font-black text-ink">{t("home.support.title")}</h2>
        <p className="mt-1.5 text-sm leading-5 text-muted">{t("home.support.text")}</p>
        <button className="mt-3.5 rounded-lg bg-brand px-4 py-2 text-sm font-black text-stone-950 transition hover:brightness-110" onClick={() => router.push("/support")}>
          {t("home.support.button")}
        </button>
      </div>
    </section>
  );
}

function avatarGradient(index: number) {
  return [
    "from-violet-500 via-fuchsia-700 to-slate-950",
    "from-emerald-400 via-teal-700 to-slate-950",
    "from-amber-300 via-orange-700 to-slate-950",
    "from-sky-400 via-blue-700 to-slate-950"
  ][index % 4];
}

function formatTime(value?: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
}
