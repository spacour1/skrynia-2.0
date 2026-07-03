"use client";

import Link from "@/lib/navigation";
import { usePathname, useRouter } from "@/lib/navigation";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bell,
  ChevronDown,
  ChevronRight,
  Gauge,
  Headphones,
  Heart,
  Languages,
  LogOut,
  MessageCircle,
  PackagePlus,
  Search,
  Settings,
  ShoppingBag,
  Store,
  Trophy,
  UserCircle,
  WalletCards,
  type LucideIcon
} from "lucide-react";
import { CurrencySwitcher } from "./CurrencySwitcher";
import { GameIcon } from "./GameIcon";
import { localeLabels, locales } from "@/i18n/config";
import { apiFetch, money, type Game } from "@/lib/api";
import { useAuth } from "@/lib/auth-store";
import { useI18n } from "@/lib/i18n";
import { firstProductMedia } from "@/lib/product-media";
import { captureEvent } from "@/lib/posthog";

type SuggestProduct = {
  id: string;
  title: string;
  description: string;
  priceCents: number;
  currency: string;
  productType?: string;
  deliveryType?: string;
  metadata?: Record<string, unknown>;
  media?: { id: string; url: string; type: string }[];
  isHot?: boolean;
  oldPriceCents?: number | null;
  gameSlug?: string;
  gameName?: string;
  categoryName?: string;
  sellerDisplayName?: string;
};

type NotificationItem = {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  titleKey?: string | null;
  bodyKey?: string | null;
  params?: Record<string, string | number> | null;
  orderId?: string | null;
  productId?: string | null;
  conversationId?: string | null;
  readAt?: string | null;
  createdAt: string;
};

type WalletResponse = {
  wallet?: {
    currency: string;
    availableCents: number;
    escrowCents: number;
  } | null;
};

export function Nav() {
  const { user, hydrated, logout } = useAuth();
  // Until we actually know (either the optimistic localStorage-cached profile already
  // landed, or hydrate()'s /auth/me call confirmed it), don't render the logged-out
  // placeholder ("Войти") - that text gets baked into the server-rendered HTML and is what
  // briefly flashes on every refresh before hydration corrects it. A neutral skeleton has
  // no false state to flash.
  const authResolved = hydrated || Boolean(user);
  const { locale, switchLocale, t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);

  useEffect(() => {
    if (pathname !== "/" || typeof window === "undefined") return;
    setSearch(new URLSearchParams(window.location.search).get("q") ?? "");
  }, [pathname]);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedSearch(search.trim()), 180);
    return () => window.clearTimeout(handle);
  }, [search]);

  useEffect(() => {
    document.documentElement.style.setProperty("--sidebar-width", "84px");
    return () => {
      document.documentElement.style.removeProperty("--sidebar-width");
    };
  }, []);

  const suggestions = useQuery({
    queryKey: ["search-suggest", debouncedSearch],
    queryFn: () => apiFetch<{ games: Game[]; products: SuggestProduct[] }>(`/marketplace/suggest?q=${encodeURIComponent(debouncedSearch)}`),
    enabled: debouncedSearch.length >= 2
  });
  const notifications = useQuery({
    queryKey: ["notifications"],
    queryFn: () => apiFetch<{ notifications: NotificationItem[]; unreadCount: number }>("/notifications?limit=12"),
    enabled: Boolean(user),
    refetchInterval: 15000
  });
  const wallet = useQuery({
    queryKey: ["wallet"],
    queryFn: () => apiFetch<WalletResponse>("/users/me/wallet"),
    enabled: Boolean(user),
    refetchInterval: 30000
  });
  const games = useQuery({
    queryKey: ["nav-games"],
    queryFn: () => apiFetch<{ games: Game[] }>("/marketplace/games"),
    staleTime: 5 * 60 * 1000
  });

  const navItems = [
    { label: t("nav.catalog"), href: "/", icon: Trophy },
    { label: t("nav.favorites"), href: "/favorites", icon: Heart, auth: true },
    { label: t("nav.chats"), href: "/messages", icon: MessageCircle, auth: true },
    { label: t("nav.myPurchases"), href: "/orders?role=buyer", icon: ShoppingBag, auth: true, match: "/orders" },
    { label: t("nav.mySales"), href: "/seller/sales", icon: Store, auth: true, match: "/seller/sales" },
    { label: t("nav.wallet"), href: "/wallet", icon: WalletCards, auth: true },
    { label: t("nav.support"), href: "/support", icon: Headphones },
    { label: t("nav.settings"), href: "/settings", icon: Settings, auth: true },
    ...(user?.role === "admin" || user?.role === "moderator" ? [{ label: t("nav.admin"), href: "/admin", icon: Gauge, auth: true }] : [])
  ];

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    goSearch(search);
  }

  function goSearch(value: string) {
    const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    const next = value.trim();
    if (next) params.set("q", next);
    else params.delete("q");
    params.delete("favorites");
    params.delete("game");
    params.delete("section");
    if (next) captureEvent("search_submitted", { query: next });
    router.push(`/${params.toString() ? `?${params.toString()}` : ""}`);
    window.dispatchEvent(new CustomEvent("market-search", { detail: { q: next, game: "", section: "", favorites: false } }));
    setSuggestOpen(false);
  }

  function openGame(game: Game) {
    router.push(`/games/${game.slug}`);
    setSearch("");
    setSuggestOpen(false);
  }

  function openProduct(product: SuggestProduct) {
    router.push(`/products/${product.id}`);
    setSuggestOpen(false);
  }

  async function markAllNotificationsRead() {
    await apiFetch("/notifications/read-all", { method: "POST" });
    notifications.refetch();
  }

  async function openNotification(item: NotificationItem) {
    if (!item.readAt) await apiFetch(`/notifications/${item.id}/read`, { method: "POST" });
    setNotificationsOpen(false);
    notifications.refetch();
    if (item.conversationId) router.push(`/messages?conversation=${item.conversationId}`);
    else if (item.orderId) router.push(`/orders/${item.orderId}`);
    else if (item.productId) router.push(`/products/${item.productId}`);
    else router.push("/dashboard");
  }

  function openRoute(href: string, auth?: boolean) {
    setCatalogOpen(false);
    router.push(auth && !user ? "/login" : href);
  }

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-line/70 bg-surface/85 backdrop-blur-xl">
        <div className="mx-auto grid min-h-[86px] max-w-[1720px] gap-4 px-4 py-4 sm:px-6 lg:grid-cols-[220px_minmax(280px,1fr)_auto] lg:items-center lg:px-8">
          <Link href="/" className="inline-flex items-center gap-3 text-xl font-extrabold tracking-normal text-ink">
            <span className="grid h-11 w-11 place-items-center rounded-xl border border-brand/20 bg-brand/10 text-brand shadow-soft">
              <Trophy className="h-5 w-5" />
            </span>
            <span>SKRYNIA</span>
          </Link>

          <form className="relative" onSubmit={submitSearch} onBlur={() => window.setTimeout(() => setSuggestOpen(false), 140)}>
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              className="focus-ring h-12 w-full rounded-2xl border border-line bg-card px-11 text-sm shadow-soft placeholder:text-muted"
              placeholder={t("nav.searchPlaceholder")}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setSuggestOpen(true);
              }}
              onFocus={() => setSuggestOpen(true)}
            />
            <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-lg border border-line bg-panel px-2 py-1 text-xs font-semibold text-muted sm:block">
              Ctrl K
            </kbd>
            {suggestOpen && debouncedSearch.length >= 2 ? (
              <SearchSuggest
                loading={suggestions.isLoading}
                games={suggestions.data?.games ?? []}
                products={suggestions.data?.products ?? []}
                query={debouncedSearch}
                onGame={openGame}
                onProduct={openProduct}
                onSearch={goSearch}
              />
            ) : null}
          </form>

          <div className="flex items-center justify-start gap-2 lg:justify-end">
            <button
              className="hidden h-11 shrink-0 items-center gap-2 rounded-xl border border-line bg-card px-3 text-sm font-black text-ink shadow-soft transition hover:border-brand/60 hover:bg-panel sm:inline-flex"
              onClick={() => router.push(user ? "/wallet" : "/login")}
            >
              <WalletCards className="h-4 w-4 text-brand" />
              {user ? money(wallet.data?.wallet?.availableCents ?? 0, wallet.data?.wallet?.currency ?? "UAH", { preserveCurrency: true }) : t("nav.balance")}
            </button>

            <div className="relative shrink-0">
              <button
                className="relative grid h-11 w-11 place-items-center rounded-xl border border-line bg-card text-ink shadow-soft transition hover:border-brand/60 hover:bg-panel"
                onClick={() => (user ? setNotificationsOpen((current) => !current) : router.push("/login"))}
                aria-label={t("nav.notifications")}
                title={t("nav.notifications")}
              >
                <Bell className="h-5 w-5" />
                {notifications.data?.unreadCount ? (
                  <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-action px-1 text-xs font-bold text-stone-950">
                    {notifications.data.unreadCount > 9 ? "9+" : notifications.data.unreadCount}
                  </span>
                ) : null}
              </button>
              {notificationsOpen && user ? (
                <NotificationDropdown
                  items={notifications.data?.notifications ?? []}
                  unreadCount={notifications.data?.unreadCount ?? 0}
                  loading={notifications.isLoading}
                  onOpen={openNotification}
                  onReadAll={markAllNotificationsRead}
                />
              ) : null}
            </div>

            <div className="relative shrink-0">
              <button
                className="inline-flex h-12 shrink-0 items-center gap-3 rounded-2xl border border-line bg-card px-3 pr-4 text-left shadow-soft transition hover:border-brand/60 hover:bg-panel"
                onClick={() => {
                  if (!authResolved) return;
                  user ? setProfileOpen((current) => !current) : router.push("/login");
                }}
              >
                <span className={`grid h-9 w-9 place-items-center overflow-hidden rounded-full bg-panel text-sm font-bold text-brand ${!authResolved ? "animate-pulse" : ""}`}>
                  {authResolved ? (user?.avatarUrl ? <img className="h-full w-full object-cover" src={user.avatarUrl} alt="" /> : (user?.displayName?.slice(0, 1).toUpperCase() ?? "U")) : null}
                </span>
                <span className="hidden leading-tight sm:block">
                  {authResolved ? (
                    <>
                      <span className="block text-sm font-bold text-ink">{user?.displayName ?? t("nav.login")}</span>
                      <span className="block text-xs text-muted">{user ? user.role : "SKRYNIA"}</span>
                    </>
                  ) : (
                    <>
                      <span className="block h-3.5 w-20 animate-pulse rounded bg-panel" />
                      <span className="mt-1 block h-3 w-12 animate-pulse rounded bg-panel" />
                    </>
                  )}
                </span>
                <ChevronDown className="hidden h-4 w-4 text-muted sm:block" />
              </button>
              {profileOpen && user ? (
                <ProfileDropdown
                  onDashboard={() => router.push("/dashboard")}
                  onSettings={() => router.push("/settings")}
                  onLogout={() => {
                    logout().finally(() => {
                      setProfileOpen(false);
                      router.push("/");
                    });
                  }}
                />
              ) : null}
            </div>
          </div>
        </div>
      </header>

      <aside className="fixed bottom-0 left-0 top-[86px] z-30 hidden w-[84px] border-r border-line/70 bg-surface/85 px-3 py-5 backdrop-blur-xl lg:block">
        <button
          className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-xl bg-action text-stone-950 shadow-lift ring-2 ring-action/30 transition hover:brightness-95"
          onClick={() => openRoute("/seller/create", true)}
          title={t("nav.createListing")}
        >
          <PackagePlus className="h-5 w-5" />
          <span className="sr-only">{t("nav.createListing")}</span>
        </button>
        <nav className="grid justify-items-center gap-3">
          {navItems.map((item) => (
            <div
              key={item.href}
              className="relative"
              onMouseEnter={item.href === "/" ? () => setCatalogOpen(true) : undefined}
              onMouseLeave={item.href === "/" ? () => setCatalogOpen(false) : undefined}
            >
              <SideNavButton
                icon={item.icon}
                label={item.label}
                active={(item.href === "/" ? pathname === "/" || catalogOpen : pathname === item.href) || Boolean(item.match && pathname.startsWith(item.match))}
                onClick={item.href === "/" ? () => {
                  router.push("/");
                  setCatalogOpen(true);
                } : () => openRoute(item.href, item.auth)}
              />
              {item.href === "/" && catalogOpen ? <CatalogMegaMenu games={games.data?.games ?? []} onGame={(slug) => openRoute(`/games/${slug}`)} /> : null}
            </div>
          ))}
        </nav>
        <span className="absolute right-[-13px] top-1/2 grid h-24 w-6 -translate-y-1/2 place-items-center rounded-r-xl border border-l-0 border-line bg-card text-muted shadow-soft">
          <ChevronRight className="h-4 w-4" />
        </span>
      </aside>

      <nav className="sticky top-[86px] z-30 flex gap-2 overflow-x-auto border-b border-line/70 bg-surface/90 px-4 py-3 backdrop-blur-xl lg:hidden">
        {navItems.map((item) => (
          <button
            key={item.href}
            className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border px-3 text-sm font-bold ${
              pathname === item.href || Boolean(item.match && pathname.startsWith(item.match)) ? "border-brand/50 bg-brand/10 text-brand" : "border-line bg-card text-muted"
            }`}
            onClick={() => openRoute(item.href, item.auth)}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </button>
        ))}
      </nav>
    </>
  );
}

function SideNavButton({ icon: Icon, label, active, onClick }: { icon: LucideIcon; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      className={`flex h-11 w-11 items-center justify-center rounded-xl text-sm font-bold transition ${
        active ? "bg-brand/10 text-brand shadow-[inset_0_0_0_1px_rgb(var(--color-brand)/0.18)]" : "text-muted hover:bg-panel hover:text-ink"
      }`}
      onClick={onClick}
      title={label}
    >
      <Icon className="h-5 w-5" />
      <span className="sr-only">{label}</span>
    </button>
  );
}

function CatalogMegaMenu({ games, onGame }: { games: Game[]; onGame: (slug: string) => void }) {
  const { t } = useI18n();
  const groups = [
    { title: t("catalogMenu.games"), text: t("catalogMenu.gamesText"), items: games.slice(0, 10), live: true },
    { title: t("catalogMenu.mobile"), text: t("catalogMenu.mobileText"), items: games.filter((game) => /mobile|genshin|roblox|brawl|clash/i.test(game.name)).slice(0, 6), live: true },
    { title: t("catalogMenu.services"), text: t("catalogMenu.servicesText"), items: [] as Game[], live: false },
    { title: t("catalogMenu.software"), text: t("catalogMenu.softwareText"), items: [] as Game[], live: false }
  ];
  const [active, setActive] = useState(groups[0].title);
  const activeGroup = groups.find((group) => group.title === active) ?? groups[0];

  return (
    <div className="absolute left-full top-0 z-[120] hidden pl-3 xl:block">
      <div className="grid w-[620px] overflow-hidden rounded-xl border border-brand/35 bg-card/95 shadow-[0_24px_90px_rgba(15,23,42,0.22)] ring-1 ring-black/5 backdrop-blur-xl dark:border-brand/25 dark:bg-slate-950/95 dark:shadow-[0_24px_90px_rgba(0,0,0,0.58)] dark:ring-white/10 xl:grid-cols-[210px_minmax(0,1fr)]">
        <div className="border-r border-line bg-panel/70 p-3 dark:bg-white/[0.03]">
        {groups.map((group) => (
          <button
            key={group.title}
            className={`mb-2 flex w-full items-center justify-between gap-3 rounded-lg px-3 py-3 text-left text-sm font-black transition ${
              active === group.title ? "border border-brand/35 bg-brand/15 text-brand shadow-soft" : "border border-transparent text-muted hover:border-line hover:bg-card hover:text-ink"
            }`}
            onMouseEnter={() => setActive(group.title)}
            onClick={() => setActive(group.title)}
          >
            <span>{group.title}</span>
            <ChevronRight className="h-4 w-4" />
          </button>
        ))}
        </div>
        <section className="bg-card p-5">
          <p className="text-lg font-black text-ink">{activeGroup.title}</p>
          <p className="mt-1 text-sm text-muted">{activeGroup.text}</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {activeGroup.items.length ? (
              activeGroup.items.map((game) => (
                <button
                  key={game.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-line bg-panel/55 px-3 py-3 text-left text-sm font-bold text-muted shadow-[0_1px_0_rgba(15,23,42,0.04)] transition hover:border-brand/60 hover:bg-brand/10 hover:text-brand"
                  onClick={() => onGame(game.slug)}
                >
                  <span className="truncate">{game.name}</span>
                  <span>{game.lotCount ?? 0}</span>
                </button>
              ))
            ) : (
              <button className="rounded-lg border border-line bg-panel px-3 py-3 text-left text-sm font-bold text-muted" onClick={() => document.getElementById("game-catalog")?.scrollIntoView({ behavior: "smooth" })}>
                {t("nav.comingSoon")}
              </button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function ProfileDropdown({
  onDashboard,
  onSettings,
  onLogout
}: {
  onDashboard: () => void;
  onSettings: () => void;
  onLogout: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="absolute right-0 top-[calc(100%+10px)] z-50 w-[300px] overflow-hidden rounded-2xl border border-line bg-card shadow-lift">
      <div className="grid gap-2 p-3">
        <MenuButton icon={UserCircle} label={t("nav.dashboard")} onClick={onDashboard} />
        <MenuButton icon={Settings} label={t("nav.settings")} onClick={onSettings} />
        <LanguageSwitcher />
        <CurrencySwitcher />
      </div>
      <div className="border-t border-line p-3">
        <MenuButton icon={LogOut} label={t("nav.logout")} onClick={onLogout} danger />
      </div>
    </div>
  );
}

/**
 * Language selector: switching swaps the /ua|/ru|/en URL prefix (same page, same query),
 * stores the skrynia_locale cookie, and persists preferred_locale for signed-in users.
 */
function LanguageSwitcher() {
  const { locale, switchLocale, t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        className="flex h-11 w-full items-center justify-between rounded-xl px-3 text-sm font-bold text-muted transition hover:bg-panel hover:text-ink"
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="inline-flex items-center gap-3">
          <Languages className="h-5 w-5" />
          {t("nav.language")}
        </span>
        <span className="text-xs text-brand">{locale.toUpperCase()}</span>
      </button>
      {open ? (
        <div className="mt-1 grid gap-1 rounded-xl border border-line bg-panel/40 p-2">
          {locales.map((option) => (
            <button
              key={option}
              className={`flex h-10 items-center justify-between rounded-lg px-3 text-sm font-bold transition ${
                option === locale ? "bg-brand/10 text-brand" : "text-muted hover:bg-panel hover:text-ink"
              }`}
              type="button"
              onClick={() => {
                setOpen(false);
                switchLocale(option);
              }}
            >
              <span>{localeLabels[option]}</span>
              <span className="text-xs">{option.toUpperCase()}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MenuButton({ icon: Icon, label, onClick, danger }: { icon: LucideIcon; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button className={`flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-bold transition hover:bg-panel ${danger ? "text-rose-500" : "text-muted hover:text-ink"}`} type="button" onClick={onClick}>
      <Icon className="h-5 w-5" />
      {label}
    </button>
  );
}

function SearchSuggest({
  loading,
  games,
  products,
  query,
  onGame,
  onProduct,
  onSearch
}: {
  loading: boolean;
  games: Game[];
  products: SuggestProduct[];
  query: string;
  onGame: (game: Game) => void;
  onProduct: (product: SuggestProduct) => void;
  onSearch: (query: string) => void;
}) {
  const { t } = useI18n();
  const hasResults = games.length || products.length;

  return (
    <div className="absolute left-0 right-0 top-[calc(100%+10px)] z-50 overflow-hidden rounded-2xl border border-line bg-card shadow-lift">
      <div className="border-b border-line bg-panel/50 px-4 py-3">
        <p className="text-xs font-bold uppercase text-muted">{t("nav.quickSearch")}</p>
        <button className="mt-1 text-left text-sm font-bold text-ink hover:text-brand" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => onSearch(query)}>
          {t("nav.searchFor")} "{query}"
        </button>
      </div>

      <div className="max-h-[520px] overflow-y-auto p-2">
        {loading ? <p className="px-3 py-4 text-sm text-muted">{t("nav.searching")}</p> : null}
        {!loading && !hasResults ? <p className="px-3 py-4 text-sm text-muted">{t("nav.noMatches")}</p> : null}

        {games.length ? (
          <SuggestSection title={t("nav.gamesAndServices")}>
            {games.map((game) => (
              <button key={game.id} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-panel" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => onGame(game)}>
                <GameIcon name={game.name} slug={game.slug} className="h-10 w-10 rounded-xl" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-black text-ink">{game.name}</span>
                  <span className="block truncate text-xs text-muted">{game.publisher ?? t("nav.game")} · {game.lotCount ?? 0} {t("nav.lots")}</span>
                </span>
                <ChevronRight className="h-4 w-4 text-muted" />
              </button>
            ))}
          </SuggestSection>
        ) : null}

        {products.length ? (
          <SuggestSection title={t("nav.listings")}>
            {products.map((product) => {
              const image = firstProductMedia(product);
              return (
                <button key={product.id} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-panel" type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => onProduct(product)}>
                  {image ? (
                    <img className="h-11 w-11 shrink-0 rounded-xl object-cover" src={image} alt="" />
                  ) : (
                    <GameIcon name={product.gameName ?? product.categoryName ?? "Product"} slug={product.gameSlug} className="h-11 w-11 rounded-xl" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-black text-ink">{product.title}</span>
                    <span className="block truncate text-xs text-muted">{[product.gameName, product.categoryName, product.productType].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-sm font-black text-brand">{money(product.priceCents, product.currency)}</span>
                    {product.isHot ? <span className="text-xs font-bold text-action">{t("nav.hot")}</span> : null}
                  </span>
                </button>
              );
            })}
          </SuggestSection>
        ) : null}
      </div>
    </div>
  );
}

function SuggestSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="p-2">
      <p className="mb-2 px-1 text-xs font-black uppercase text-brand">{title}</p>
      <div className="grid gap-1">{children}</div>
    </div>
  );
}

function NotificationDropdown({
  items,
  unreadCount,
  loading,
  onOpen,
  onReadAll
}: {
  items: NotificationItem[];
  unreadCount: number;
  loading: boolean;
  onOpen: (item: NotificationItem) => void;
  onReadAll: () => void;
}) {
  const { language, t } = useI18n();
  return (
    <div className="absolute right-0 top-[calc(100%+10px)] z-50 w-[360px] overflow-hidden rounded-2xl border border-line bg-card shadow-lift">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-panel/55 px-4 py-3">
        <div>
          <p className="font-black text-ink">{t("nav.notifications")}</p>
          <p className="text-xs text-muted">{unreadCount ? `${unreadCount} ${t("nav.unread")}` : t("nav.allRead")}</p>
        </div>
        {unreadCount ? (
          <button className="text-xs font-bold text-brand hover:underline" type="button" onClick={onReadAll}>
            {t("nav.readAll")}
          </button>
        ) : null}
      </div>
      <div className="max-h-[460px] overflow-y-auto p-2">
        {loading ? <p className="px-3 py-4 text-sm text-muted">{t("nav.loadingNotifications")}</p> : null}
        {!loading && !items.length ? (
          <div className="grid min-h-[180px] place-items-center text-center">
            <p className="max-w-[240px] text-sm leading-6 text-muted">{t("nav.noNotifications")}</p>
          </div>
        ) : null}
        {items.map((item) => {
          // Key-based notifications re-localize instantly on language switch; older rows
          // without keys fall back to the title/body stored at creation time.
          const title = item.titleKey ? t(item.titleKey, item.params ?? undefined) : item.title;
          const body = item.bodyKey ? t(item.bodyKey, item.params ?? undefined) : item.body;
          return (
            <button key={item.id} className={`flex w-full gap-3 rounded-xl p-3 text-left transition hover:bg-panel ${item.readAt ? "opacity-75" : "bg-brand/5"}`} type="button" onClick={() => onOpen(item)}>
              <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${item.readAt ? "bg-muted/40" : "bg-action"}`} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-black text-ink">{title}</span>
                {body ? <span className="mt-1 line-clamp-2 block text-xs leading-5 text-muted">{body}</span> : null}
                <span className="mt-2 block text-xs text-muted">{formatNotificationTime(item.createdAt, language)}</span>
              </span>
              <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function formatNotificationTime(value: string, language: string) {
  return new Date(value).toLocaleString(language, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}
