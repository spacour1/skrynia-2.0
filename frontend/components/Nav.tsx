"use client";

import Link from "@/lib/navigation";
import { usePathname, useRouter } from "@/lib/navigation";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bell,
  ChevronDown,
  Gauge,
  Headphones,
  Heart,
  LayoutGrid,
  MessageCircle,
  PackagePlus,
  Plus,
  Search,
  Settings,
  ShoppingBag,
  WalletCards,
  X
} from "lucide-react";
import { apiFetch, money, type Game } from "@/lib/api";
import { useAuth } from "@/lib/auth-store";
import { useI18n } from "@/lib/i18n";
import { captureEvent } from "@/lib/posthog";
import { CatalogPanel } from "./nav/CatalogPanel";
import { NotificationDropdown, ProfileDropdown } from "./nav/NavDropdowns";
import { SearchSuggest } from "./nav/SearchSuggest";
import { SideNavButton } from "./nav/SideNav";
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
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [catalogPanelOpen, setCatalogPanelOpen] = useState(false);

  useEffect(() => {
    if (pathname !== "/" || typeof window === "undefined") return;
    setSearch(new URLSearchParams(window.location.search).get("q") ?? "");
  }, [pathname]);

  // Any route change closes the overlay menus so they never linger over a new page.
  useEffect(() => {
    setCatalogPanelOpen(false);
    setNotificationsOpen(false);
    setProfileOpen(false);
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

  // Staff (admin/moderator) never see a "become a seller" pitch; regular users see it only
  // until they actually have a listing, after which the card becomes a seller-hub shortcut.
  const isStaff = user?.role === "admin" || user?.role === "moderator";
  const sellerProducts = useQuery({
    queryKey: ["nav-seller-products"],
    queryFn: () => apiFetch<{ products: unknown[] }>("/marketplace/seller/products"),
    enabled: Boolean(user) && !isStaff,
    staleTime: 5 * 60 * 1000
  });
  const sellerCtaVariant: SellerCtaVariant = !user
    ? "guest"
    : isStaff
      ? "admin"
      : (sellerProducts.data?.products?.length ?? 0) > 0
        ? "seller"
        : "user";

  const navItems = [
    { label: t("nav.createListing"), href: "/seller/create", icon: PackagePlus, auth: true, match: "/seller/create" },
    { label: t("nav.favorites"), href: "/favorites", icon: Heart, auth: true },
    { label: t("nav.chats"), href: "/messages", icon: MessageCircle, auth: true, match: "/messages" },
    { label: t("nav.myPurchases"), href: "/orders?role=buyer", icon: ShoppingBag, auth: true, match: "/orders" },
    { label: t("nav.support"), href: "/support", icon: Headphones },
    { label: t("nav.settings"), href: "/settings", icon: Settings, auth: true },
    ...(user?.role === "admin" || user?.role === "moderator" ? [{ label: t("nav.admin"), href: "/admin", icon: Gauge, auth: true, match: "/admin" }] : [])
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
    router.push(auth && !user ? "/login" : href);
  }

  function openCatalogRoute(href: string) {
    setCatalogPanelOpen(false);
    router.push(href);
  }

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-line/70 bg-surface/85 backdrop-blur-xl">
        <div className="relative z-50 mx-auto grid min-h-[86px] max-w-[1720px] gap-4 px-4 py-4 sm:px-6 lg:grid-cols-[220px_minmax(280px,1fr)_auto] lg:items-center lg:px-8">
          <Link href="/" className="inline-flex items-center gap-3 text-xl font-extrabold tracking-normal text-ink">
            <img src="/brand/keepgame-logo.svg" alt="Keep Game" className="h-11 w-11 rounded-xl shadow-soft" />
            <span className="leading-[1.05]">
              <span className="block">Keep</span>
              <span className="block text-brand">Game</span>
            </span>
          </Link>

          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <button
              type="button"
              className={`inline-flex h-12 shrink-0 items-center gap-2 rounded-2xl border px-3.5 text-sm font-black shadow-soft transition sm:px-4 ${
                catalogPanelOpen ? "border-brand bg-brand text-stone-950" : "border-line bg-card text-ink hover:border-brand/60 hover:bg-panel"
              }`}
              onClick={() => {
                setCatalogPanelOpen((current) => !current);
                setNotificationsOpen(false);
                setProfileOpen(false);
              }}
              aria-expanded={catalogPanelOpen}
              aria-label={t("nav.catalog")}
            >
              {catalogPanelOpen ? <X className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
              <span className="hidden sm:inline">{t("nav.catalog")}</span>
            </button>
            <form className="relative min-w-0 flex-1" onSubmit={submitSearch} onBlur={() => window.setTimeout(() => setSuggestOpen(false), 140)}>
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
          </div>

          <div className="flex items-center justify-start gap-2 lg:justify-end">
            <button
              className="hidden h-11 shrink-0 items-center gap-2 rounded-xl border border-brand/60 bg-brand/10 px-4 text-sm font-black text-brand shadow-soft transition hover:bg-brand hover:text-stone-950 sm:inline-flex"
              onClick={() => openRoute("/seller/create", true)}
            >
              <PackagePlus className="h-4 w-4" />
              {t("nav.sell")}
            </button>

            <div className="hidden h-11 shrink-0 items-center gap-1 rounded-xl border border-line bg-card pl-3 pr-1.5 shadow-soft sm:flex">
              <button
                className="inline-flex items-center gap-2 text-sm font-black text-ink transition hover:text-brand"
                onClick={() => router.push(user ? "/wallet" : "/login")}
              >
                <WalletCards className="h-4 w-4 text-brand" />
                {money(wallet.data?.wallet?.availableCents ?? 0, wallet.data?.wallet?.currency ?? "UAH", { preserveCurrency: true })}
              </button>
              <button
                className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-stone-950 transition hover:brightness-110"
                onClick={() => router.push(user ? "/wallet" : "/login")}
                aria-label={t("nav.wallet")}
                title={t("nav.wallet")}
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>

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
                      <span className="block text-xs text-muted">{user ? user.role : "Keep Game"}</span>
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

        {catalogPanelOpen ? (
          <>
            <button
              type="button"
              className="fixed inset-0 z-40 cursor-default bg-black/50 backdrop-blur-sm"
              aria-label={t("catalogPanel.close")}
              onClick={() => setCatalogPanelOpen(false)}
            />
            <div className="absolute left-0 right-0 top-full z-50 border-b border-line/70 bg-surface shadow-[0_40px_80px_rgba(0,0,0,0.45)]">
              <CatalogPanel games={games.data?.games ?? []} loading={games.isLoading} onNavigate={openCatalogRoute} />
            </div>
          </>
        ) : null}
      </header>

      <aside className="fixed bottom-0 left-0 top-[86px] z-30 hidden w-[188px] flex-col border-r border-line/70 bg-surface/85 px-3 py-4 shadow-[18px_0_70px_rgba(0,0,0,0.16)] backdrop-blur-xl lg:flex">
        <nav className="flex-1 space-y-1.5 overflow-y-auto pr-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {navItems.map((item) => (
            <SideNavButton
              key={item.label}
              icon={item.icon}
              label={item.label}
              active={pathname === item.href || Boolean(item.match && pathname.startsWith(item.match))}
              onClick={() => openRoute(item.href, item.auth)}
            />
          ))}
        </nav>
        <SellerCta variant={sellerCtaVariant} onGo={(href) => openRoute(href, false)} />
      </aside>

      <nav className="sticky top-[86px] z-30 flex gap-2 overflow-x-auto border-b border-line/70 bg-surface/90 px-4 py-3 backdrop-blur-xl lg:hidden">
        {navItems.map((item) => (
          <button
            key={item.label}
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

type SellerCtaVariant = "guest" | "user" | "seller" | "admin";

/**
 * Bottom-of-sidebar call to action, tailored to who is looking at it:
 * - guest  -> register and start selling
 * - user   -> create their first listing (real seller onboarding)
 * - seller -> jump to their sales dashboard (no more "become a seller" pitch)
 * - admin  -> jump to the admin panel instead of any seller pitch
 */
function SellerCta({ variant, onGo }: { variant: SellerCtaVariant; onGo: (href: string) => void }) {
  const { t } = useI18n();
  const card = {
    guest: { title: t("nav.becomeSeller"), text: t("nav.becomeSellerText"), button: t("nav.register"), href: "/register" },
    user: { title: t("nav.becomeSeller"), text: t("nav.becomeSellerText"), button: t("nav.createListing"), href: "/seller/create" },
    seller: { title: t("nav.sellerHub"), text: t("nav.sellerHubText"), button: t("nav.mySales"), href: "/seller/sales" },
    admin: { title: t("nav.adminHub"), text: t("nav.adminHubText"), button: t("nav.openAdmin"), href: "/admin" }
  }[variant];

  return (
    <div className="mt-3 shrink-0 rounded-xl border border-brand/40 bg-panel/80 p-3 shadow-soft">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-black leading-tight text-ink">{card.title}</p>
        <img src="/brand/keepgame-mascot.svg" alt="" className="h-10 w-10 shrink-0" />
      </div>
      <p className="mt-1.5 text-[11px] leading-4 text-muted">{card.text}</p>
      <button
        className="mt-2.5 w-full rounded-lg bg-brand py-2 text-xs font-black text-stone-950 transition hover:brightness-110"
        onClick={() => onGo(card.href)}
      >
        {card.button}
      </button>
    </div>
  );
}
