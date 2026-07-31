import type {
  AuthUserDto,
  OrderSummaryDto,
  OrderStatus,
  ProductCardDto,
  Role
} from "./contracts";
import type { WireMoneyCents } from "./money";

export type {
  AdminDisputeMessageDto,
  AdminOrderDto,
  AdminOrderMutationDto,
  AdminPendingOrderDto,
  AdminProductDto,
  AdminProductMutationDto,
  AdminProductSummaryDto,
  AuthUserDto,
  DeliveryType,
  DisputeAdminDto,
  DisputeAdminSummaryDto,
  DisputeDecision,
  DisputeMessageDto,
  DisputeModeratorDto,
  DisputeModeratorSummaryDto,
  DisputeParticipantDto,
  MessageDto,
  OrderDetailDto,
  OrderMutationDto,
  OrderSummaryDto,
  OrderStatus,
  ProductCardDto,
  ProductDetailDto,
  ProductMetadataFieldDto,
  ProductStatus,
  ProductType,
  PublicSellerDto,
  PublicSellerStatsDto,
  Role
} from "./contracts";

// Routed through the Next.js rewrite in next.config.mjs so the browser always talks to
// its own origin — this keeps auth/CSRF cookies same-site even when the backend lives on
// a different domain (e.g. Vercel frontend + Railway backend).
export const API_URL = "/api";
export const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:4000/ws";

export type User = AuthUserDto & {
  settings?: Record<string, unknown>;
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
  banner?: string | null;
  logoImage?: string | null;
  backgroundImage?: string | null;
  description?: string | null;
  shortDescription?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  catalogType?: "game" | "mobile" | "platform" | "service";
  showOnHomepage?: boolean;
  isPopular?: boolean;
  isRecommended?: boolean;
  homepageOrder?: number;
  createdAt: string;
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

/** @deprecated Prefer the endpoint-specific DTO type exported above. */
export type Product = ProductCardDto;
/** @deprecated Prefer `OrderSummaryDto`, `OrderDetailDto`, or `OrderMutationDto`. */
export type Order = OrderSummaryDto;

export type Conversation = {
  id: string;
  buyerId?: string;
  sellerId?: string;
  productId?: string | null;
  productTitle?: string | null;
  orderId?: string | null;
  orderStatus?: OrderStatus | null;
  buyerDisplayName?: string;
  buyerAvatarUrl?: string | null;
  sellerDisplayName?: string;
  sellerAvatarUrl?: string | null;
  amountCents?: WireMoneyCents | null;
  currency?: string | null;
  lastMessageAt?: string | null;
  lastMessageBody?: string | null;
  unreadCount?: number;
  blocked?: boolean;
  canSendMessage?: boolean;
  createdAt: string;
};

export type ConversationContextType = "direct" | "product" | "order";

export type ConversationContext = {
  conversationId: string;
  type: ConversationContextType;
  label: string;
  productId?: string | null;
  productTitle?: string | null;
  orderId?: string | null;
  orderStatus?: OrderStatus | null;
  amountCents?: WireMoneyCents | null;
  currency?: string | null;
  unreadCount?: number;
  lastMessageAt?: string | null;
  lastMessageBody?: string | null;
  blocked?: boolean;
  canSendMessage?: boolean;
  createdAt: string;
};

export type ConversationGroup = {
  peerUserId: string;
  peerDisplayName: string;
  peerAvatarUrl?: string | null;
  isOnline?: boolean | null;
  totalUnreadCount: number;
  lastMessageAt?: string | null;
  lastMessageBody?: string | null;
  contexts: ConversationContext[];
};

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public payload?: unknown,
    public retryAfterSeconds?: number
  ) {
    super(message);
  }

  get code(): string | undefined {
    const normalized = this.payload as { error?: { code?: string } } | undefined;
    return normalized?.error?.code;
  }
}

function parseRetryAfter(value: string | null) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);

  const retryAt = Date.parse(value);
  if (!Number.isFinite(retryAt)) return undefined;
  return Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
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

export function onAuthenticationRefreshed(handler: () => void): () => void {
  const channel = getAuthChannel();
  const channelListener = (event: MessageEvent) => {
    if ((event.data as { type?: string } | undefined)?.type === "session-refreshed") {
      handler();
    }
  };
  const windowListener = () => handler();
  channel?.addEventListener("message", channelListener);
  window.addEventListener(AUTH_REFRESHED_EVENT, windowListener);
  return () => {
    channel?.removeEventListener("message", channelListener);
    window.removeEventListener(AUTH_REFRESHED_EVENT, windowListener);
  };
}

function markRefreshed() {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(RECENT_REFRESH_KEY, String(Date.now()));
    window.dispatchEvent(new CustomEvent(AUTH_REFRESHED_EVENT));
    getAuthChannel()?.postMessage({ type: "session-refreshed" });
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
    const normalized = payload as {
      message?: string;
      error?: {
        message?: string;
        code?: string;
        traceId?: string;
        retryAfterSeconds?: number;
      };
    };
    throw new ApiError(
      normalized.error?.message ?? normalized.message ?? "Request failed",
      response.status,
      payload,
      parseRetryAfter(response.headers.get("Retry-After")) ??
        normalized.error?.retryAfterSeconds
    );
  }

  if (response.headers.get("X-Session-Rotated") === "true") markRefreshed();
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
