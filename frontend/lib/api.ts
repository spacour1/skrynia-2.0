// Routed through the Next.js rewrite in next.config.mjs so the browser always talks to
// its own origin — this keeps auth/CSRF cookies same-site even when the backend lives on
// a different domain (e.g. Vercel frontend + Railway backend).
export const API_URL = "/api";
export const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:4000/ws";

export type Role = "user" | "seller" | "admin";

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
};

export type Category = {
  id: string;
  slug: string;
  name: string;
  description?: string;
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

export const DISPLAY_CURRENCIES: { code: CurrencyCode; label: string; symbol: string }[] = [
  { code: "UAH", label: "Гривна", symbol: "₴" },
  { code: "USD", label: "Доллар", symbol: "$" },
  { code: "EUR", label: "Евро", symbol: "€" }
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
  return [
    "/admin",
    "/dashboard",
    "/orders",
    "/wallet",
    "/seller/earnings",
    "/seller/sales"
  ].some((path) => window.location.pathname.startsWith(path));
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public payload?: unknown
  ) {
    super(message);
  }
}

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : undefined;
}

function rawFetch(path: string, options: RequestInit) {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type") && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
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

let refreshInFlight: Promise<boolean> | null = null;

function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = rawFetch("/auth/refresh", { method: "POST" })
      .then((response) => response.ok)
      .catch(() => false)
      .finally(() => {
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
      const refreshed = await refreshSession();
      if (refreshed) return apiFetch<T>(path, options, true);
      if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
        window.location.assign("/login");
      }
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
