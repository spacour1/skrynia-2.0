"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck,
  BadgePercent,
  ChevronRight,
  Coins,
  Grid2X2,
  Headphones,
  Heart,
  MessageCircle,
  PackageCheck,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Star,
  Store,
  Timer,
  WalletCards,
  Zap
} from "lucide-react";
import { GameIcon } from "../components/GameIcon";
import { apiFetch, money, type Game, type Order, type Product } from "../lib/api";
import { useAuth } from "../lib/auth-store";
import { useI18n } from "../lib/i18n";
import { firstProductMedia } from "../lib/product-media";
import { showAppToast } from "../lib/toast-events";

const productVisuals = [
  "from-amber-400 via-orange-500 to-slate-950",
  "from-red-500 via-orange-600 to-slate-950",
  "from-blue-500 via-indigo-500 to-slate-950",
  "from-violet-500 via-blue-500 to-slate-950",
  "from-emerald-400 via-teal-600 to-slate-950"
];

export default function HomePage() {
  const router = useRouter();
  const client = useQueryClient();
  const user = useAuth((s) => s.user);
  const { language, setLanguageAndReload, t } = useI18n();
  const [q, setQ] = useState("");
  const [game, setGame] = useState("");
  const [section, setSection] = useState("");
  const [sort, setSort] = useState("newest");
  const [showFavorites, setShowFavorites] = useState(false);
  const [showAllGames, setShowAllGames] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);

  useEffect(() => {
    function applyParams() {
      const params = new URLSearchParams(window.location.search);
      setQ(params.get("q") ?? "");
      setGame(params.get("game") ?? "");
      setSection(params.get("section") ?? "");
      setSort(params.get("sort") ?? "newest");
      setShowFavorites(params.get("favorites") === "1");
    }

    function applySearch(event: Event) {
      const detail = (event as CustomEvent<{ q?: string; sort?: string; favorites?: boolean; game?: string; section?: string }>).detail;
      if (typeof detail?.q === "string") setQ(detail.q);
      if (typeof detail?.sort === "string") setSort(detail.sort);
      if (typeof detail?.favorites === "boolean") setShowFavorites(detail.favorites);
      if (typeof detail?.game === "string") {
        setGame(detail.game);
        setSection("");
        setShowFavorites(false);
      }
      if (typeof detail?.section === "string") setSection(detail.section);
    }

    applyParams();
    window.addEventListener("market-search", applySearch);
    window.addEventListener("popstate", applyParams);
    return () => {
      window.removeEventListener("market-search", applySearch);
      window.removeEventListener("popstate", applyParams);
    };
  }, []);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (game) params.set("game", game);
    if (section) params.set("section", section);
    params.set("sort", sort);
    return params.toString();
  }, [q, game, section, sort]);

  const games = useQuery({
    queryKey: ["games"],
    queryFn: () => apiFetch<{ games: Game[] }>("/marketplace/games")
  });
  const gameDetail = useQuery({
    queryKey: ["game-detail", game],
    queryFn: () => apiFetch<{ game: Game; sections: { id: string; slug: string; name: string; lotCount?: number }[] }>(`/marketplace/games/${game}`),
    enabled: Boolean(game)
  });
  const products = useQuery({
    queryKey: ["products", query],
    queryFn: () => apiFetch<{ products: Product[] }>(`/marketplace/products?${query}`),
    enabled: !showFavorites
  });
  const favorites = useQuery({
    queryKey: ["favorites"],
    queryFn: () => apiFetch<{ products: Product[] }>("/marketplace/favorites"),
    enabled: Boolean(user && showFavorites)
  });
  const favoriteIds = useQuery({
    queryKey: ["favorite-ids"],
    queryFn: () => apiFetch<{ productIds: string[] }>("/marketplace/favorites/ids"),
    enabled: Boolean(user)
  });
  const orders = useQuery({
    queryKey: ["orders"],
    queryFn: () => apiFetch<{ orders: Order[] }>("/orders"),
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
      client.invalidateQueries({ queryKey: ["favorites"] });
      client.invalidateQueries({ queryKey: ["products"] });
      showAppToast({
        type: "favorite",
        title: variables.liked ? "Объявление удалено из Избранных" : "Объявление добавлено в Избранные",
        productId: variables.productId
      });
    }
  });

  const gamesList = games.data?.games ?? [];
  const visibleGames = showAllGames ? gamesList : gamesList.slice(0, 16);
  const productsList = showFavorites ? favorites.data?.products ?? [] : products.data?.products ?? [];
  const likedSet = new Set(favoriteIds.data?.productIds ?? []);
  const activeGameName = gamesList.find((item) => item.slug === game)?.name;

  function scrollToProducts() {
    document.getElementById("popular-products")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function selectGame(slug: string) {
    router.push(`/games/${slug}`);
  }

  function openFavorites() {
    if (!user) {
      router.push("/login");
      return;
    }
    router.push("/favorites");
  }

  function supportTelegram() {
    window.open("https://t.me/skrynia_support", "_blank", "noopener,noreferrer");
  }

  const menuItems = [
    { label: "Каталог", icon: Grid2X2, action: () => setCatalogOpen((value) => !value), active: catalogOpen },
    { label: "Чаты", icon: MessageCircle, action: () => router.push(user ? "/messages" : "/login") },
    { label: "Мои покупки", icon: ShoppingBag, action: () => router.push(user ? "/orders?role=buyer" : "/login") },
    { label: "Мои продажи", icon: Store, action: () => router.push(user ? "/seller/sales" : "/login") },
    { label: "Кошелек", icon: WalletCards, action: () => router.push(user ? "/wallet" : "/login") },
    { label: "Избранное", icon: Heart, action: openFavorites, active: showFavorites },
    { label: "Поддержка", icon: Headphones, action: supportTelegram },
    { label: "Настройки", icon: Settings, action: () => router.push(user ? "/settings" : "/login") }
  ];

  const translatedMenuItems = [
    { label: t("nav.catalog"), icon: Grid2X2, action: () => setCatalogOpen((value) => !value), active: catalogOpen },
    { label: t("nav.chats"), icon: MessageCircle, action: () => router.push(user ? "/messages" : "/login") },
    { label: t("nav.myPurchases"), icon: ShoppingBag, action: () => router.push(user ? "/orders?role=buyer" : "/login") },
    { label: t("nav.mySales"), icon: Store, action: () => router.push(user ? "/seller/sales" : "/login") },
    { label: t("nav.wallet"), icon: WalletCards, action: () => router.push(user ? "/wallet" : "/login") },
    { label: t("nav.favorites"), icon: Heart, action: openFavorites, active: showFavorites },
    { label: t("nav.support"), icon: Headphones, action: supportTelegram },
    { label: t("nav.settings"), icon: Settings, action: () => router.push(user ? "/settings" : "/login") }
  ];

  const trustItems = [
    { title: "Гарант сделок", text: "Средства в escrow", icon: ShieldCheck },
    { title: "Поддержка 24/7", text: "Telegram и тикеты", icon: Headphones },
    { title: "Отзывы и рейтинг", text: "Только после заказа", icon: Star },
    { title: "Мгновенная выдача", text: "Для ключей и кодов", icon: Zap }
  ];

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <aside className="hidden">
        <button className="app-button-action h-12 w-full text-[0px]" onClick={() => router.push(user ? "/seller/create" : "/login")}>
          <Store className="h-5 w-5" />
          <span className="text-base">{t("nav.createListing")}</span>
          Создать лот
        </button>
        <nav className="app-card relative overflow-visible p-3">
          <div className="space-y-1">
            {translatedMenuItems.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.label}>
                  <button
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold transition ${
                      item.active
                        ? "bg-brand/10 text-brand shadow-[inset_0_0_0_1px_rgb(var(--color-brand)/0.16)]"
                        : "text-muted hover:bg-panel hover:text-ink"
                    }`}
                    onClick={item.action}
                  >
                    <Icon className="h-5 w-5" />
                    {item.label}
                  </button>
                </div>
              );
            })}
          </div>
          {catalogOpen ? <CatalogMegaMenu games={gamesList} onGame={selectGame} /> : null}
        </nav>

        <div className="space-y-3">
          <button className="app-card flex w-full items-center justify-between px-4 py-3 text-sm font-bold" onClick={() => setLanguageAndReload(nextLanguage(language))}>
            <span>{language === "en" ? "Language: English" : language === "uk" ? "Мова: українська" : "Язык: русский"}</span>
            <ChevronRight className="h-4 w-4 text-muted" />
          </button>
        </div>
      </aside>

      <main className="relative z-0 space-y-6">
        <section className="app-card isolate overflow-hidden">
          <div className="grid items-center gap-8 bg-panel/70 p-7 lg:grid-cols-[1fr_330px]">
            <div>
              <h1 className="max-w-xl text-4xl font-extrabold leading-tight tracking-normal text-ink md:text-5xl">
                Твой маркетплейс цифровых ценностей
              </h1>
              <p className="mt-5 max-w-xl text-base leading-7 text-muted">
                Покупай и продавай аккаунты, предметы, валюту, ключи и услуги с безопасным escrow.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <button className="app-button px-6 py-3" onClick={scrollToProducts}>
                  Переглянути товари
                </button>
                <button className="app-button-secondary px-6 py-3" onClick={() => router.push("/rules")}>
                  Как это работает
                </button>
              </div>
            </div>
            <div className="relative mx-auto h-56 w-full max-w-[340px]">
              <div className="absolute inset-x-5 bottom-5 h-28 rounded-[28px] border border-brand/20 bg-gradient-to-br from-card via-panel to-brand/10 shadow-lift dark:from-slate-950 dark:via-slate-900 dark:to-yellow-900/40" />
              <div className="absolute inset-x-10 top-8 h-24 rotate-[-3deg] rounded-[26px] border border-brand/30 bg-gradient-to-br from-white via-panel to-action/30 shadow-soft dark:from-slate-900 dark:via-slate-950 dark:to-yellow-900/50" />
              <div className="absolute left-1/2 top-[92px] grid h-16 w-14 -translate-x-1/2 place-items-center rounded-2xl border border-action/50 bg-action text-stone-950 shadow-lift">
                <ShieldCheck className="h-7 w-7" />
              </div>
              <div className="absolute inset-x-20 bottom-0 h-4 rounded-full bg-brand/20 blur-xl dark:bg-action/20" />
            </div>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
          {trustItems.map((item) => {
            const Icon = item.icon;
            return (
              <article key={item.title} className="app-card flex items-center gap-4 p-4">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand">
                  <Icon className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="text-sm font-bold">{item.title}</h3>
                  <p className="mt-1 text-xs text-muted">{item.text}</p>
                </div>
              </article>
            );
          })}
        </section>

        <section id="game-catalog" className="space-y-4 scroll-mt-28">
          <div className="app-card overflow-hidden">
            <div className="flex flex-col gap-4 border-b border-line bg-panel/55 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-black uppercase text-brand">Игры и сервисы</p>
                <h2 className="mt-1 text-2xl font-black text-ink">Каталог предложений</h2>
                <p className="mt-1 text-sm text-muted">Выберите игру, платформу или сервис. Карточки адаптируются под экран и не обрезают иконки.</p>
              </div>
              <button className="app-button-secondary h-11 px-4" onClick={() => setShowAllGames((value) => !value)}>
                {showAllGames ? "Свернуть" : `Показать все (${gamesList.length})`}
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {visibleGames.map((item) => {
                const selected = game === item.slug;
                const lots = item.lotCount ?? 0;
                return (
                  <button
                    key={item.id}
                    className={`group relative overflow-hidden rounded-lg border p-4 text-left shadow-soft transition hover:-translate-y-0.5 hover:border-brand/70 hover:bg-panel hover:shadow-lift ${
                      selected ? "border-brand/70 bg-brand/10 ring-1 ring-brand/30" : "border-line bg-card"
                    }`}
                    onClick={() => selectGame(item.slug)}
                  >
                    <span className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-brand/5 transition group-hover:bg-brand/10" />
                    <span className="relative flex items-start gap-3">
                      <GameIcon name={item.name} slug={item.slug} className="h-14 w-14 rounded-2xl" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-base font-black text-ink">{item.name}</span>
                        <span className="mt-1 block truncate text-xs text-muted">{item.publisher ?? "SKRYNIA catalog"}</span>
                        <span className="mt-3 inline-flex rounded-full bg-panel px-2.5 py-1 text-xs font-bold text-muted">
                          {lots} {pluralLots(lots)}
                        </span>
                      </span>
                    </span>
                    <span className="mt-4 block h-1.5 overflow-hidden rounded-full bg-line">
                      <span className="block h-full rounded-full bg-brand transition-all" style={{ width: `${Math.min(100, Math.max(8, lots * 22))}%` }} />
                    </span>
                    <span className="mt-3 flex items-center justify-between text-xs font-bold text-muted">
                      <span>{selected ? "Выбрано" : "Открыть разделы"}</span>
                      <ChevronRight className={`h-4 w-4 transition ${selected ? "text-brand" : "group-hover:text-brand"}`} />
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {game && (
            <section className="app-card overflow-hidden">
              <div className="flex flex-col gap-4 border-b border-line bg-panel/45 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <GameIcon name={activeGameName ?? "Game"} slug={game} className="h-12 w-12 rounded-2xl" />
                  <div>
                    <h3 className="text-lg font-black text-ink">Разделы {activeGameName}</h3>
                    <p className="text-sm text-muted">Выберите конкретный тип предложения внутри игры.</p>
                  </div>
                </div>
                <button className="app-button-secondary h-10 px-4" onClick={() => setSection("")}>Все разделы</button>
              </div>
              <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
                {gameDetail.data?.sections.map((item) => (
                  <button
                    key={item.id}
                    className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-left text-sm font-bold transition ${
                      section === item.slug ? "border-brand/70 bg-brand/10 text-brand" : "border-line bg-card text-ink hover:border-brand/60 hover:bg-panel"
                    }`}
                    onClick={() => {
                      setSection(item.slug);
                      scrollToProducts();
                    }}
                  >
                    <span className="truncate">{item.name}</span>
                    <span className="rounded-full bg-panel px-2 py-0.5 text-xs text-muted">{item.lotCount ?? 0}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </section>

        <section className="app-card p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-extrabold">Популярные сервисы</h2>
            <button className="inline-flex items-center gap-1 text-sm font-bold text-brand" onClick={() => { setSort("sales"); scrollToProducts(); }}>
              Переглянути всі <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-4">
            {[
              ["Прокачка аккаунта", "Поднятие ранга, уровня, рейтинга", "1240+"],
              ["Бустинг", "Буст MMR, рейтинга, ранга", "980+"],
              ["Выполнение заданий", "Квесты, челленджи, ивенты", "870+"],
              ["Доставка предметов", "Передача предметов и валюты", "760+"]
            ].map(([title, text, count]) => (
              <button key={title} className="interactive-card p-5 text-center" onClick={() => { setSort("sales"); scrollToProducts(); }}>
                <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand/10 text-brand">
                  <Zap className="h-7 w-7" />
                </span>
                <h3 className="mt-4 font-extrabold">{title}</h3>
                <p className="mt-2 min-h-[2.5rem] text-xs leading-5 text-muted">{text}</p>
                <p className="mt-3 text-xs font-bold text-muted">{count}</p>
              </button>
            ))}
          </div>
        </section>

        <section id="popular-products" className="space-y-4 scroll-mt-28">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-extrabold">{showFavorites ? "Избранные товары" : "Популярные товары"}</h2>
              <p className="mt-1 text-sm text-muted">{showFavorites ? "Товары, которые ты лайкнул" : activeGameName ? `Фильтр: ${activeGameName}` : "Свежие предложения маркетплейса"}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className={`rounded-xl px-4 py-2 text-sm font-bold transition ${!game && !showFavorites ? "bg-brand text-white dark:text-stone-950" : "bg-card text-muted hover:bg-panel"}`} onClick={() => { setGame(""); setSection(""); setShowFavorites(false); }}>
                Все товары
              </button>
              <button className={`rounded-xl px-4 py-2 text-sm font-bold transition ${showFavorites ? "bg-brand text-white dark:text-stone-950" : "bg-card text-muted hover:bg-panel"}`} onClick={openFavorites}>
                Избранное
              </button>
              <select className="app-input py-2" value={sort} onChange={(event) => setSort(event.target.value)} disabled={showFavorites}>
                <option value="newest">Новые</option>
                <option value="sales">Больше продаж</option>
                <option value="discount">Скидки</option>
                <option value="price_asc">Цена ниже</option>
                <option value="price_desc">Цена выше</option>
                <option value="rating">Рейтинг</option>
              </select>
            </div>
          </div>

          {(products.isLoading || favorites.isLoading) ? (
            <section className="app-card p-8 text-center text-muted">Загружаем товары...</section>
          ) : productsList.length ? (
            <div className="grid gap-5 sm:grid-cols-2 2xl:grid-cols-4">
              {productsList.map((product, index) => (
                <MarketProductCard
                  key={product.id}
                  product={product}
                  index={index}
                  liked={likedSet.has(product.id)}
                  onToggleLike={() => {
                    if (!user) router.push("/login");
                    else likeMutation.mutate({ productId: product.id, liked: likedSet.has(product.id) });
                  }}
                />
              ))}
            </div>
          ) : (
            <section className="app-card p-8 text-center text-muted">
              {showFavorites ? "Пока нет избранных товаров." : "Товары не найдены."}
            </section>
          )}
        </section>

        <section className="app-card grid gap-4 bg-panel/70 p-5 md:grid-cols-3">
          <FeatureLine icon={ShieldCheck} title="Безопасные сделки" text="Escrow защищает каждую транзакцию." />
          <FeatureLine icon={BadgeCheck} title="Честный рейтинг" text="Отзывы доступны только после заказа." />
          <FeatureLine icon={Headphones} title="Поддержка 24/7" text="Споры, тикеты и Telegram-канал поддержки." />
        </section>
      </main>

      <aside className="space-y-5 xl:sticky xl:top-[106px] xl:self-start">
        <section className="app-card overflow-hidden">
          <div className="p-5">
            <h2 className="text-xl font-extrabold">Последние действия</h2>
            <div className="mt-5 space-y-5">
              {user ? (
                orders.data?.orders?.length ? (
                  orders.data.orders.slice(0, 4).map((order, index) => (
                    <Link key={order.id} href={`/orders/${order.id}`} className="flex items-start gap-3 rounded-xl p-2 transition hover:bg-panel">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-panel text-brand">
                        {index % 2 ? <Coins className="h-5 w-5" /> : <ShoppingBag className="h-5 w-5" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold">{order.productTitle ?? order.product_title}</span>
                        <span className="mt-1 block text-xs text-muted">{order.status}</span>
                      </span>
                      <span className="text-sm font-bold text-rose-500">{money(order.amountCents ?? order.amount_cents, order.currency)}</span>
                    </Link>
                  ))
                ) : (
                  <p className="text-sm leading-6 text-muted">Пока нет действий. Первый заказ появится здесь.</p>
                )
              ) : (
                <p className="text-sm leading-6 text-muted">Войдите, чтобы видеть историю заказов и операций.</p>
              )}
            </div>
          </div>
          <button className="flex w-full items-center justify-center gap-1 border-t border-line bg-panel/50 px-5 py-4 text-sm font-bold text-brand" onClick={() => router.push(user ? "/orders" : "/login")}>
            Посмотреть все <ChevronRight className="h-4 w-4" />
          </button>
        </section>

        <button
          className="app-card group w-full p-5 text-left transition hover:border-brand/70 hover:shadow-lift"
          onClick={() => router.push(user ? "/messages" : "/login")}
        >
          <span className="flex items-center justify-between gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand/10 text-brand">
              <MessageCircle className="h-5 w-5" />
            </span>
            <ChevronRight className="h-5 w-5 text-muted transition group-hover:text-brand" />
          </span>
          <span className="mt-4 block text-lg font-black text-ink">Общий чат</span>
          <span className="mt-2 block text-sm leading-6 text-muted">Минималистичный вход в сообщения и диалоги по заказам.</span>
        </button>
      </aside>
    </div>
  );
}

function MarketProductCard({
  product,
  index,
  liked,
  onToggleLike
}: {
  product: Product;
  index: number;
  liked: boolean;
  onToggleLike: () => void;
}) {
  const router = useRouter();
  const visual = productVisuals[index % productVisuals.length];
  const imageUrl = firstProductMedia(product);
  const discount =
    product.oldPriceCents && Number(product.oldPriceCents) > Number(product.priceCents)
      ? Math.round(((Number(product.oldPriceCents) - Number(product.priceCents)) / Number(product.oldPriceCents)) * 100)
      : 0;

  return (
    <article
      className="interactive-card relative cursor-pointer overflow-hidden"
      role="link"
      tabIndex={0}
      onClick={() => router.push(`/products/${product.id}`)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          router.push(`/products/${product.id}`);
        }
      }}
    >
      <div className={`relative block h-32 overflow-hidden bg-gradient-to-br ${visual}`}>
        {imageUrl ? <img className="absolute inset-0 h-full w-full object-cover" src={imageUrl} alt={product.title} /> : null}
        {imageUrl ? <div className="absolute inset-0 bg-black/25" /> : null}
        <div className="absolute left-3 top-3 flex max-w-[75%] flex-wrap gap-2">
          {product.isHot ? <span className="rounded-full bg-brand px-2 py-1 text-xs font-bold text-white dark:text-stone-950">ХИТ</span> : null}
          {product.isRecommended ? <span className="rounded-full bg-white/90 px-2 py-1 text-xs font-bold text-slate-800">SKRYNIA</span> : null}
          {discount ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-500 px-2 py-1 text-xs font-bold text-white">
              <BadgePercent className="h-3 w-3" />-{discount}%
            </span>
          ) : null}
          {!product.isHot && !product.isRecommended && !discount ? (
            <span className="rounded-full bg-brand px-2 py-1 text-xs font-bold text-white dark:text-stone-950">TOP</span>
          ) : null}
        </div>
        <button
          className={`absolute right-3 top-3 z-20 grid h-9 w-9 place-items-center rounded-full bg-white/90 text-slate-700 shadow-soft transition hover:scale-105 ${
            liked ? "text-rose-500" : ""
          }`}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onToggleLike();
          }}
          aria-label={liked ? "Убрать из избранного" : "Добавить в избранное"}
        >
          <Heart className={`h-4 w-4 ${liked ? "fill-current" : ""}`} />
        </button>
        <span className="absolute bottom-4 left-4 text-4xl font-black text-white/85">{product.title.slice(0, 2).toUpperCase()}</span>
      </div>
      <div className="relative p-4">
        <p className="line-clamp-2 min-h-[2.5rem] font-extrabold text-ink transition group-hover:text-brand">
          {product.title}
        </p>
        <Link href={`/sellers/${product.sellerId}`} className="relative z-20 mt-4 flex items-center gap-2 rounded-lg text-xs text-muted transition hover:text-brand" onClick={(event) => event.stopPropagation()}>
          <span className="grid h-6 w-6 place-items-center rounded-full bg-panel font-bold text-brand">{product.sellerDisplayName.slice(0, 1).toUpperCase()}</span>
          <span className="truncate">{product.sellerDisplayName}</span>
          <Star className="h-3.5 w-3.5 fill-action text-action" />
          <span>{Number(product.sellerRating ?? 0).toFixed(1)}</span>
        </Link>
        <p className="mt-1 flex items-center gap-1 text-xs font-bold text-muted">
          <span className={`h-2.5 w-2.5 rounded-full ${product.sellerOnline ? "bg-emerald-400 shadow-[0_0_0_4px_rgba(52,211,153,0.16)]" : "bg-muted"}`} />
          {product.sellerOnline ? "Онлайн" : "Не в сети"}
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {product.gameName ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-panel px-2 py-1 text-muted">
              <GameIcon name={product.gameName} slug={product.gameSlug} className="h-4 w-4 rounded-md" />
              {product.gameName}
            </span>
          ) : null}
          <span className="rounded-full bg-panel px-2 py-1 text-muted">{product.productType ?? product.sectionName ?? "service"}</span>
          {product.deliveryType === "instant" ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 font-bold text-emerald-500">
              <Timer className="h-3 w-3" />
              моментально
            </span>
          ) : null}
        </div>
        <div className="mt-4 flex items-center justify-between gap-3">
          <div>
            {product.oldPriceCents ? <p className="text-xs text-muted line-through">{money(Number(product.oldPriceCents), product.currency)}</p> : null}
            <p className="text-lg font-extrabold">{money(Number(product.priceCents), product.currency)}</p>
          </div>
          <p className="text-xs text-muted">Продано: {product.salesCount ?? 0}</p>
        </div>
        <p className="mt-2 text-xs text-muted">{product.favoriteCount ?? 0} лайков</p>
      </div>
    </article>
  );
}

function pluralLots(count: number) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "лот";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "лота";
  return "лотов";
}

function CatalogMegaMenu({ games, onGame }: { games: Game[]; onGame: (slug: string) => void }) {
  const groups = [
    { title: "Игры", text: "PC и консольные игры", items: games.slice(0, 8), live: true },
    { title: "Мобильные игры", text: "PUBG Mobile, Brawl Stars, MLBB", items: games.filter((game) => /mobile|genshin|roblox/i.test(game.name)).slice(0, 5), live: true },
    { title: "Сервисы", text: "Пополнение, подписки, помощь", items: [] as Game[], live: false },
    { title: "Программы", text: "Ключи, лицензии, аккаунты", items: [] as Game[], live: false }
  ];
  const [active, setActive] = useState(groups[0].title);
  const activeGroup = groups.find((group) => group.title === active) ?? groups[0];

  return (
    <div className="absolute left-[calc(100%+14px)] top-0 z-[120] hidden w-[620px] overflow-hidden rounded-xl border border-brand/35 bg-card/95 shadow-[0_24px_90px_rgba(15,23,42,0.22)] ring-1 ring-black/5 backdrop-blur-xl dark:border-brand/25 dark:bg-slate-950/95 dark:shadow-[0_24px_90px_rgba(0,0,0,0.58)] dark:ring-white/10 xl:grid xl:grid-cols-[210px_minmax(0,1fr)]">
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
          {activeGroup.items.length ? activeGroup.items.map((game) => (
              <button
                key={game.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-line bg-panel/55 px-3 py-3 text-left text-sm font-bold text-muted shadow-[0_1px_0_rgba(15,23,42,0.04)] transition hover:border-brand/60 hover:bg-brand/10 hover:text-brand"
                onClick={() => onGame(game.slug)}
              >
                <span className="truncate">{game.name}</span>
                <span>{game.lotCount ?? 0}</span>
              </button>
            )) : (
              <button className="rounded-lg border border-line bg-panel px-3 py-3 text-left text-sm font-bold text-muted" onClick={() => document.getElementById("game-catalog")?.scrollIntoView({ behavior: "smooth" })}>
                Скоро будет наполнено
              </button>
            )}
        </div>
      </section>
    </div>
  );
}

function nextLanguage(language: string) {
  if (language === "ru") return "en";
  if (language === "en") return "uk";
  return "ru";
}

function FeatureLine({
  icon: Icon,
  title,
  text
}: {
  icon: typeof ShieldCheck;
  title: string;
  text: string;
}) {
  return (
    <article className="flex items-center gap-4">
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-card text-brand shadow-soft">
        <Icon className="h-5 w-5" />
      </span>
      <span>
        <span className="block text-sm font-extrabold">{title}</span>
        <span className="mt-1 block text-xs leading-5 text-muted">{text}</span>
      </span>
    </article>
  );
}
