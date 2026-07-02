// Routed through the Next.js rewrite in next.config.mjs so the browser always talks to
// its own origin — this keeps auth/CSRF cookies same-site even when the backend lives on
// a different domain (e.g. Vercel frontend + Railway backend).
export const API_URL = "/api";
export const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:4000/ws";

export type Role = "user" | "moderator" | "admin";

export type User = {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  avatarUrl?: string | null;
  pushEnabled?: boolean;
  twoFactorEnabled?: boolean;
  settings?: Record<string, unknown>;
  createdAt?: string;
  online?: boolean;
  emailVerified?: boolean;
  phone?: string | null;
  phoneVerified?: boolean;
  telegramConnected?: boolean;
};

export type Category = {
  id: string;
  slug: string;
  name: string;
  description?: string;
  riskLevel?: "low" | "medium" | "high";
};

export type Game = {
  id: string;
  slug: string;
  name: string;
  publisher?: string;
  iconUrl?: string;
  popularity?: number;
  lotCount?: number;
};

export type GameSection = {
  id: string;
  slug: string;
  name: string;
  description?: string;
  categorySlug?: string;
  categoryName?: string;
  lotCount?: number;
  schema?: Record<string, unknown>;
  productType?: Product["productType"];
  categoryRiskLevel?: "low" | "medium" | "high";
};

export type Product = {
  id: string;
  title: string;
  description: string;
  priceCents: number;
  currency: string;
  stock: number;
  status?: string;
  categoryId?: string;
  categorySlug?: string;
  categoryName?: string;
  gameId?: string;
  gameSlug?: string;
  gameName?: string;
  sectionId?: string;
  sectionSlug?: string;
  sectionName?: string;
  server?: string;
  platform?: string;
  metadata?: Record<string, unknown>;
  deliveryTemplate?: string;
  deliveryType?: "manual" | "instant";
  productType?: "account" | "key" | "topup" | "boosting" | "service" | "item" | "currency";
  oldPriceCents?: number | null;
  salesCount?: number;
  isHot?: boolean;
  isRecommended?: boolean;
  favoriteCount?: number;
  media?: { id: string; url: string; type: string; status?: string }[];
  sellerId: string;
  sellerDisplayName: string;
  sellerRating: number;
  sellerReviewCount: number;
  sellerOnline?: boolean;
};

export type Order = {
  id: string;
  status: string;
  productId?: string;
  productTitle?: string;
  product_title?: string;
  buyerId?: string;
  buyer_id?: string;
  buyerDisplayName?: string;
  buyerAvatarUrl?: string | null;
  sellerId?: string;
  seller_id?: string;
  sellerDisplayName?: string;
  sellerAvatarUrl?: string | null;
  quantity: number;
  amountCents?: number;
  amount_cents?: number;
  feeCents?: number;
  currency: string;
  delivery_note?: string;
  autoReleaseAt?: string;
  createdAt?: string;
};

export type Conversation = {
  id: string;
  buyerId?: string;
  sellerId?: string;
  productId?: string | null;
  productTitle?: string | null;
  orderId?: string | null;
  orderStatus?: string | null;
  buyerDisplayName?: string;
  buyerAvatarUrl?: string | null;
  sellerDisplayName?: string;
  sellerAvatarUrl?: string | null;
  amountCents?: number | null;
  currency?: string | null;
  lastMessageAt?: string | null;
  lastMessageBody?: string | null;
  unreadCount?: number;
  blocked?: boolean;
  canSendMessage?: boolean;
  createdAt?: string;
};

export type CurrencyCode = "UAH" | "USD" | "EUR";

export type CurrencyRate = {
  code: CurrencyCode;
  rateToUah: number;
  source: string;
  asOf: string;
  updatedAt: string;
};

export type CurrencyRatesResponse = {
  baseCurrency: CurrencyCode;
  rates: CurrencyRate[];
};

// Labels are ISO-style English names; the UI shows only the currency code, so these
// don't need per-locale translations.
export const DISPLAY_CURRENCIES: { code: CurrencyCode; label: string; symbol: string }[] = [
  { code: "UAH", label: "Hryvnia", symbol: "₴" },
  { code: "USD", label: "Dollar", symbol: "$" },
  { code: "EUR", label: "Euro", symbol: "€" }
];

export const DISPLAY_CURRENCY_EVENT = "display-currency-change";

let currencyToUahRate: Record<CurrencyCode, number> = {
  UAH: 1,
  USD: 0,
  EUR: 0
};

const currencySymbols: Record<CurrencyCode, string> = {
  UAH: "₴",
  USD: "$",
  EUR: "€"
};

export function getDisplayCurrency(): CurrencyCode | null {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem("displayCurrency");
  return isCurrencyCode(stored) ? stored : null;
}

export function setDisplayCurrency(currency: CurrencyCode) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem("displayCurrency", currency);
  window.dispatchEvent(new CustomEvent(DISPLAY_CURRENCY_EVENT, { detail: { currency } }));
}

export function setCurrencyRates(rates: CurrencyRate[]) {
  const next = { ...currencyToUahRate };
  for (const rate of rates) {
    next[rate.code] = rate.rateToUah;
  }
  currencyToUahRate = next;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(DISPLAY_CURRENCY_EVENT, { detail: { rates } }));
  }
}

export function convertMoneyCents(cents = 0, fromCurrency = "UAH", toCurrency: CurrencyCode) {
  const from = isCurrencyCode(fromCurrency) ? fromCurrency : "UAH";
  if (from === toCurrency) return cents;
  if (!currencyToUahRate[from] || !currencyToUahRate[toCurrency]) return cents;
  return Math.round((cents * currencyToUahRate[from]) / currencyToUahRate[toCurrency]);
}

export function money(cents?: number, currency = "UAH", options: { preserveCurrency?: boolean } = {}) {
  const sourceCurrency = isCurrencyCode(currency) ? currency : "UAH";
  const shouldPreserve = options.preserveCurrency ?? isAccountingPath();
  const displayCurrency = shouldPreserve ? sourceCurrency : getDisplayCurrency() ?? sourceCurrency;
  const value = displayCurrency === sourceCurrency ? cents ?? 0 : convertMoneyCents(cents ?? 0, sourceCurrency, displayCurrency);
  const amount = new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value / 100);
  return `${amount} ${currencySymbols[displayCurrency]}`;
}

function isCurrencyCode(value: unknown): value is CurrencyCode {
  return value === "UAH" || value === "USD" || value === "EUR";
}

function isAccountingPath() {
  if (typeof window === "undefined") return false;
  // Strip the /ua|/ru|/en prefix so path checks keep working under locale routing.
  const locale = currentPathLocale();
  const pathname = locale ? window.location.pathname.slice(locale.length + 1) || "/" : window.location.pathname;
  return [
    "/admin",
    "/dashboard",
    "/orders",
    "/wallet",
    "/seller/earnings",
    "/seller/sales"
  ].some((path) => pathname.startsWith(path));
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public payload?: unknown
  ) {
    super(message);
  }

  get code(): string | undefined {
    const normalized = this.payload as { error?: { code?: string } } | undefined;
    return normalized?.error?.code;
  }
}

export function isEmailNotVerifiedError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403 && error.code === "email_not_verified";
}

export function isPhoneNotVerifiedError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403 && error.code === "phone_not_verified";
}

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : undefined;
}

function currentPathLocale(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const first = window.location.pathname.split("/")[1];
  return first === "ua" || first === "ru" || first === "en" ? first : undefined;
}

function rawFetch(path: string, options: RequestInit) {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type") && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  // Tell the backend which language to respond in (validation errors, localized
  // notifications, emails). Kept in sync with the URL prefix by the middleware.
  if (!headers.has("x-locale")) {
    const locale = readCookie("skrynia_locale") ?? currentPathLocale();
    if (locale) headers.set("x-locale", locale);
  }
  const method = (options.method ?? "GET").toUpperCase();
  if (MUTATING_METHODS.has(method)) {
    const csrfToken = readCookie("csrf_token");
    if (csrfToken) headers.set("X-CSRF-Token", csrfToken);
  }
  // The access/refresh/csrf tokens live in httpOnly cookies — "include" is what makes
  // the browser send and accept them on requests to a different port (cross-origin in dev).
  return fetch(`${API_URL}${path}`, { ...options, headers, credentials: "include" });
}

// Cross-tab coordination: cookies (and therefore the session) are shared by every tab on
// this origin, so two tabs racing their own /auth/refresh calls around the same time is a
// real scenario (e.g. both notice a 401 within the same second). Without coordination, the
// second tab's call redeems the refresh token tab A already rotated away, gets rejected,
// and clears cookies tab A just set - a spurious logout caused purely by the race, not by
// anything actually being wrong with the session.
const AUTH_SYNC_CHANNEL = "auth-session-sync";
const REFRESH_LOCK_NAME = "auth-refresh-lock";
const RECENT_REFRESH_KEY = "auth_last_refresh_at";
const RECENT_REFRESH_WINDOW_MS = 3000;

let authChannel: BroadcastChannel | null = null;
function getAuthChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  if (!authChannel) authChannel = new BroadcastChannel(AUTH_SYNC_CHANNEL);
  return authChannel;
}

/** Tells every other open tab that the session just ended (explicit logout or a refresh that was genuinely rejected), so they drop their cached user instead of finding out the hard way on their next request. */
export function broadcastSessionEnded() {
  getAuthChannel()?.postMessage({ type: "session-ended" });
}

export function onSessionEnded(handler: () => void): () => void {
  const channel = getAuthChannel();
  if (!channel) return () => undefined;
  const listener = (event: MessageEvent) => {
    if ((event.data as { type?: string } | undefined)?.type === "session-ended") handler();
  };
  channel.addEventListener("message", listener);
  return () => channel.removeEventListener("message", listener);
}

function recentlyRefreshedElsewhere() {
  if (typeof window === "undefined") return false;
  const last = Number(window.localStorage.getItem(RECENT_REFRESH_KEY) ?? 0);
  return Date.now() - last < RECENT_REFRESH_WINDOW_MS;
}

/** Fired on a successful silent refresh, so long-lived connections (the chat WebSocket) that don't go through apiFetch can notice their access-token cookie just changed and reconnect proactively instead of waiting to be dropped. */
export const AUTH_REFRESHED_EVENT = "auth-refreshed";

function markRefreshed() {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(RECENT_REFRESH_KEY, String(Date.now()));
    window.dispatchEvent(new CustomEvent(AUTH_REFRESHED_EVENT));
  }
}

type RefreshOutcome = "ok" | "invalid" | "retry-later";

async function performRefresh(): Promise<RefreshOutcome> {
  // Another tab may have refreshed (and rotated the cookie) just before this one acquired
  // the lock - trust that instead of redeeming the now-already-rotated token ourselves.
  if (recentlyRefreshedElsewhere()) return "ok";
  try {
    const response = await rawFetch("/auth/refresh", { method: "POST" });
    if (response.ok) {
      markRefreshed();
      return "ok";
    }
    // 401/403 means the refresh token itself was rejected (expired, revoked, banned) -
    // that's a real logout. Anything else (503 while Redis is unreachable, a network
    // blip, a rate limit) is not: the session may still be perfectly valid.
    return response.status === 401 || response.status === 403 ? "invalid" : "retry-later";
  } catch {
    return "retry-later";
  }
}

async function runExclusiveRefresh(): Promise<RefreshOutcome> {
  if (typeof navigator !== "undefined" && "locks" in navigator) {
    return await navigator.locks.request(REFRESH_LOCK_NAME, performRefresh);
  }
  return performRefresh();
}

let refreshInFlight: Promise<RefreshOutcome> | null = null;

function refreshSession(): Promise<RefreshOutcome> {
  if (!refreshInFlight) {
    refreshInFlight = runExclusiveRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

export async function apiFetch<T>(path: string, options: RequestInit = {}, isRetry = false): Promise<T> {
  const response = await rawFetch(path, options);

  if (!response.ok) {
    // Only a previously-established session (csrf cookie present) is worth refreshing;
    // an anonymous 401 (e.g. /auth/me for a logged-out visitor) should just fail quietly.
    if (response.status === 401 && !isRetry && path !== "/auth/refresh" && readCookie("csrf_token")) {
      const outcome = await refreshSession();
      if (outcome === "ok") return apiFetch<T>(path, options, true);
      if (outcome === "invalid") {
        broadcastSessionEnded();
        if (typeof window !== "undefined" && !window.location.pathname.includes("/login")) {
          const locale = currentPathLocale() ?? readCookie("skrynia_locale") ?? "ua";
          window.location.assign(`/${locale}/login`);
        }
      }
      // "retry-later": a transient backend hiccup, not a real logout - fall through and
      // surface this one request's failure without redirecting anywhere.
    }

    const payload = await response.json().catch(() => ({}));
    const normalized = payload as { message?: string; error?: { message?: string; code?: string; traceId?: string } };
    throw new ApiError(
      normalized.error?.message ?? normalized.message ?? "Request failed",
      response.status,
      payload
    );
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
