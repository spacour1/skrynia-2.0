"use client";

import Link from "@/lib/navigation";
import { usePathname, useRouter } from "@/lib/navigation";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bell,
  ChevronDown,
  ChevronRight,
  Gauge,
  Headphones,
  Heart,
  MessageCircle,
  PackagePlus,
  Search,
  Settings,
  ShoppingBag,
  Store,
  Trophy,
  WalletCards
} from "lucide-react";
import { apiFetch, money, type Game } from "@/lib/api";
import { useAuth } from "@/lib/auth-store";
import { useI18n } from "@/lib/i18n";
import { captureEvent } from "@/lib/posthog";
import { NotificationDropdown, ProfileDropdown } from "./nav/NavDropdowns";
import { SearchSuggest } from "./nav/SearchSuggest";
import { CatalogMegaMenu, SideNavButton } from "./nav/SideNav";
import type { NotificationItem, SuggestProduct } from "./nav/types";

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
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (pathname !== "/" || typeof window === "undefined") return;
    setSearch(new URLSearchParams(window.location.search).get("q") ?? "");
  }, [pathname]);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedSearch(search.trim()), 180);
    return () => window.clearTimeout(handle);
  }, [search]);

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
    if (item.conversationId) router.push(`/messages?conversationId=${item.conversationId}`);
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

      <aside
        className={`fixed bottom-0 left-0 top-[86px] z-30 hidden transform-gpu border-r border-line/70 bg-surface/85 px-3 py-5 shadow-[18px_0_70px_rgba(0,0,0,0.16)] backdrop-blur-xl transition-[width] duration-300 ease-out will-change-[width] lg:block ${
          sidebarOpen ? "w-[252px]" : "w-[84px]"
        }`}
      >
        <button
          className={`mb-5 flex h-14 items-center rounded-[15px] border border-action/70 bg-action text-stone-950 shadow-[0_14px_34px_rgba(251,191,36,0.22),inset_0_1px_0_rgba(255,255,255,0.42)] ring-1 ring-black/10 transition hover:brightness-105 ${
            sidebarOpen ? "w-full justify-start gap-3 px-4" : "mx-auto w-14 justify-center"
          }`}
          onClick={() => openRoute("/seller/create", true)}
          title={t("nav.createListing")}
        >
          <PackagePlus className="h-5 w-5" />
          <span className={`overflow-hidden whitespace-nowrap text-sm font-black transition-[max-width,opacity] duration-200 ${sidebarOpen ? "max-w-[170px] opacity-100" : "max-w-0 opacity-0"}`}>{t("nav.createListing")}</span>
        </button>
        <nav className={`grid gap-3 ${sidebarOpen ? "justify-items-stretch" : "justify-items-center"}`}>
          {navItems.map((item) => (
            <div
              key={item.href}
              className="relative w-full"
              onMouseEnter={item.href === "/" ? () => setCatalogOpen(true) : undefined}
              onMouseLeave={item.href === "/" ? () => setCatalogOpen(false) : undefined}
            >
              <SideNavButton
                icon={item.icon}
                label={item.label}
                active={(item.href === "/" ? pathname === "/" || catalogOpen : pathname === item.href) || Boolean(item.match && pathname.startsWith(item.match))}
                expanded={sidebarOpen}
                onClick={item.href === "/" ? () => {
                  router.push("/");
                  setCatalogOpen(true);
                } : () => openRoute(item.href, item.auth)}
              />
              {item.href === "/" && catalogOpen ? <CatalogMegaMenu games={games.data?.games ?? []} onGame={(slug) => openRoute(`/games/${slug}`)} /> : null}
            </div>
          ))}
        </nav>
        <button
          type="button"
          className="absolute left-full top-1/2 grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-line bg-card/95 text-muted shadow-lift ring-4 ring-surface/80 backdrop-blur transition hover:border-brand/60 hover:bg-panel hover:text-brand"
          onClick={() => {
            setSidebarOpen((current) => {
              if (current) setCatalogOpen(false);
              return !current;
            });
          }}
          title={sidebarOpen ? t("nav.collapseSidebar") : t("nav.expandSidebar")}
          aria-label={sidebarOpen ? t("nav.collapseSidebar") : t("nav.expandSidebar")}
        >
          <ChevronRight className={`h-5 w-5 transition-transform ${sidebarOpen ? "rotate-180" : ""}`} />
        </button>
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
