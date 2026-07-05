"use client";

import { useRouter } from "@/lib/navigation";
import type { FormEvent } from "react";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { apiFetch, type Game } from "../../lib/api";
import { useAuth } from "../../lib/auth-store";
import { buildSectionTiles, getGameTileTheme, type CategoryTile, type GameTileThemeConfig } from "../../lib/game-catalog";

type ChatMessage = {
  id: string;
  name: string;
  text: string;
  time: string;
  avatar: string;
};

const initialChatMessages: ChatMessage[] = [
  { id: "m1", name: "ShadowHunter", text: "Хтось продає акаунт з PSN?", time: "16:52", avatar: "/avatars/keyforge-market.svg" },
  { id: "m2", name: "Kira", text: "Шукаю рідкісні скіни на CS2", time: "16:53", avatar: "/avatars/nova-accounts.svg" },
  { id: "m3", name: "NecX", text: "Підкажіть, як працює гарантія?", time: "16:54", avatar: "/avatars/pixel-boost.svg" },
  { id: "m4", name: "GameLord", text: "Куплю ключ, все супер, дякую!", time: "16:55", avatar: "/avatars/raid-supply.svg" },
  { id: "m5", name: "Viper", text: "Обміняю акаунт на щось цікаве", time: "16:55", avatar: "/avatars/nova-accounts.svg" }
];

export default function HomePage() {
  const router = useRouter();
  const user = useAuth((s) => s.user);

  const games = useQuery({
    queryKey: ["games"],
    queryFn: () => apiFetch<{ games: Game[] }>("/marketplace/games")
  });

  const gamesList = games.data?.games ?? [];
  const mobileGames = buildSectionTiles("mobile", gamesList);
  const platformGames = buildSectionTiles("platform", gamesList);
  const popularGames = buildSectionTiles("popular", gamesList);

  function selectGame(slug: string) {
    router.push(`/games/${slug}`);
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_360px]">
      <main className="relative min-w-0 overflow-hidden">
        <div className="pointer-events-none absolute inset-x-[-24px] top-0 h-[620px] overflow-hidden">
          <img
            className="absolute inset-x-0 top-0 h-[360px] w-full object-cover object-[62%_center] opacity-95"
            src="/assets/home/header/main-header.webp"
            alt=""
            fetchPriority="high"
            draggable={false}
          />
          <div className="absolute inset-x-0 top-0 h-[360px] bg-[linear-gradient(90deg,rgba(3,6,10,0.98)_0%,rgba(3,6,10,0.84)_32%,rgba(3,6,10,0.44)_60%,rgba(3,6,10,0.16)_100%)]" />
          <div className="absolute inset-x-0 top-0 h-[460px] bg-[linear-gradient(180deg,rgba(3,6,10,0)_0%,rgba(3,6,10,0.18)_44%,rgba(3,6,10,0.78)_74%,rgb(var(--color-bg))_100%)]" />
          <div className="absolute inset-x-0 top-[300px] h-[320px] bg-[radial-gradient(ellipse_at_center,rgba(246,190,78,0.08),transparent_52%),linear-gradient(180deg,rgba(3,6,10,0.2),rgb(var(--color-bg))_82%)]" />
        </div>

        <div className="relative z-10 space-y-5 pb-4">
          <Hero />

          <section id="game-catalog" className="space-y-5 scroll-mt-28">
            <CategoryCarousel title="Мобільні ігри" items={mobileGames} onSelect={selectGame} />
            <CategoryCarousel title="ПК та консольні ігри" items={platformGames} onSelect={selectGame} compact />
            <CategoryCarousel title="Популярні тайтли" items={popularGames} onSelect={selectGame} />
          </section>
        </div>
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
    <section className="relative min-h-[274px]">
      <div className="relative z-10 flex min-h-[274px] flex-col justify-center px-6 pb-8 pt-9 sm:px-8 lg:px-10 xl:px-12">
        <h1 className="max-w-[540px] text-[30px] font-black leading-[1.08] tracking-normal text-white md:text-[38px] xl:text-[42px]">
          Купуй та продавай
          <span className="block text-brand">ігрові акаунти, предмети,</span>
          <span className="block text-brand">ключі та послуги</span>
        </h1>
        <div className="mt-8 grid max-w-[820px] gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
    <article className="flex min-w-0 items-center gap-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-black/26 text-brand ring-1 ring-brand/30">
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
          <button className="grid h-8 w-8 place-items-center rounded-lg bg-panel/25 text-muted hover:bg-panel/70 hover:text-brand" onClick={() => scroll(-1)} aria-label="Назад">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button className="grid h-8 w-8 place-items-center rounded-lg bg-panel/25 text-muted hover:bg-panel/70 hover:text-brand" onClick={() => scroll(1)} aria-label="Вперед">
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
        avatar: "/avatars/raid-supply.svg"
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
    <section className="relative min-h-[180px] overflow-hidden rounded-lg border border-brand/20 bg-card p-5 shadow-soft">
      <div className="pointer-events-none absolute -right-5 top-7 h-24 w-24 rounded-full border-[8px] border-brand/50" />
      <div className="pointer-events-none absolute right-6 top-12 grid h-14 w-14 place-items-center rounded-full bg-brand/10 text-brand">
        <Headphones className="h-8 w-8" />
      </div>
      <div className="relative z-10 max-w-[220px] pr-4">
        <h2 className="text-lg font-black text-ink">Ми завжди на зв'язку</h2>
        <p className="mt-2 text-sm leading-6 text-muted">Наша підтримка допоможе з будь-яким питанням</p>
        <button className="mt-4 rounded-lg border border-brand/70 px-4 py-2 text-sm font-black text-brand transition hover:bg-brand hover:text-stone-950" onClick={onOpen}>
          Написати в підтримку
        </button>
      </div>
    </section>
  );
}

