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
// Browser storage cannot provide server-side fencing after a tab is suspended beyond its
// TTL. Aborted operations therefore retain a short uncertainty fence; backend session
// rotation validation remains the final authority.
const AUTH_SYNC_CHANNEL = "auth-session-sync";
const REFRESH_LOCK_NAME = "auth-refresh-lock";
const RECENT_REFRESH_KEY = "auth_last_refresh_at";
const RECENT_REFRESH_GENERATION_KEY = "auth_last_refresh_generation";
const SESSION_ESTABLISHED_AT_KEY = "auth_session_established_at";
const REFRESH_LEASE_KEY_PREFIX = "auth_refresh_lease:";
const RECENT_REFRESH_WINDOW_MS = 3000;
const REFRESH_LEASE_TTL_MS = 30_000;
const REFRESH_LEASE_HEARTBEAT_MS = 5_000;
const REFRESH_LEASE_ACQUIRE_TIMEOUT_MS = 15_000;
const REFRESH_OPERATION_TIMEOUT_MS = 60_000;
const REFRESH_LEASE_RETRY_MIN_MS = 25;
const REFRESH_LEASE_RETRY_MAX_MS = 75;
const REFRESH_LEASE_POLL_MIN_MS = 200;
const REFRESH_LEASE_POLL_MAX_MS = 400;
const SESSION_ESTABLISHING_PATHS = new Set([
  "/auth/register",
  "/auth/login",
  "/auth/2fa/verify",
  "/auth/telegram"
]);
const SESSION_ROTATING_PATHS = new Set([
  ...SESSION_ESTABLISHING_PATHS,
  "/users/me/password",
  "/users/me/2fa/enable",
  "/users/me/2fa/disable",
  "/users/me/2fa/backup-codes/regenerate"
]);

type AuthSyncMessage = {
  type?: string;
  refreshedAt?: number;
  generation?: string;
  logoutRequestedAt?: number;
  sessionEndedAt?: number;
  sessionEstablishedAt?: number;
};

type RefreshLease = {
  ownerId: string;
  acquiredAt: number;
  expiresAt: number;
  generation: string;
  choosing: boolean;
  holding: boolean;
  ticket: number;
};

type RefreshLeaseRead =
  | { available: true; leases: RefreshLease[] }
  | { available: false; leases: [] };

type RefreshLeaseAcquisition =
  | { status: "acquired"; lease: RefreshLease }
  | { status: "unavailable" }
  | { status: "timed-out" };

class RefreshCoordinationTimeoutError extends Error {
  constructor() {
    super("Timed out waiting for cross-tab session coordination");
    this.name = "RefreshCoordinationTimeoutError";
  }
}

class RefreshCoordinationUnavailableError extends Error {
  constructor() {
    super("Cross-tab session coordination is unavailable");
    this.name = "RefreshCoordinationUnavailableError";
  }
}

type RefreshObservation = {
  refreshedAt: number;
  generation: string | null;
};

let lastObservedRefreshAt = 0;
let lastObservedRefreshGeneration: string | null = null;
let lastObservedSessionEstablishedAt = 0;
let authChannel: BroadcastChannel | null = null;
let authChannelUnavailable = false;
let authStorageListenerInstalled = false;
type SessionEstablishedSource = "local" | "peer";
const sessionEstablishedHandlers = new Set<(
  establishedAt: number,
  source: SessionEstablishedSource
) => void>();
const sessionEndedHandlers = new Set<(message: {
  logoutRequestedAt?: number;
  sessionEndedAt?: number;
}) => void>();

/** Runs synchronously inside the cookie-mutation lock after login/register succeeds. */
export function onSessionEstablished(handler: (
  establishedAt: number,
  source: SessionEstablishedSource
) => void): () => void {
  ensureAuthStorageListener();
  sessionEstablishedHandlers.add(handler);
  return () => sessionEstablishedHandlers.delete(handler);
}

function emitSessionEstablished(establishedAt: number, source: SessionEstablishedSource) {
  for (const handler of sessionEstablishedHandlers) {
    try {
      handler(establishedAt, source);
    } catch {
      // An observer must not turn a successful server login into a failed request.
    }
  }
}

function ensureAuthStorageListener() {
  if (typeof window === "undefined" || authStorageListenerInstalled) return;
  authStorageListenerInstalled = true;
  window.addEventListener("storage", (event) => {
    if (event.key !== SESSION_ESTABLISHED_AT_KEY) return;
    const establishedAt = validSessionEstablishedAt(event.newValue);
    if (establishedAt !== null && establishedAt >= lastObservedSessionEstablishedAt) {
      lastObservedSessionEstablishedAt = establishedAt;
      emitSessionEstablished(establishedAt, "peer");
    }
  });
}

function notifySessionEstablished() {
  const establishedAt = nextAuthEventTimestamp(getLastSessionEstablishedAt());
  lastObservedSessionEstablishedAt = establishedAt;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(SESSION_ESTABLISHED_AT_KEY, String(establishedAt));
    } catch {
      // BroadcastChannel and the in-memory timestamp still protect restricted contexts.
    }
  }
  postAuthSyncMessage({ type: "session-established", sessionEstablishedAt: establishedAt });
  emitSessionEstablished(establishedAt, "local");
}

function authSyncMessage(value: unknown): AuthSyncMessage | null {
  return value && typeof value === "object" ? value as AuthSyncMessage : null;
}

function validSessionEstablishedAt(value: unknown): number | null {
  const timestamp = Number(value);
  return Number.isSafeInteger(timestamp) &&
    timestamp > 0 &&
    timestamp <= Date.now() + 60_000
    ? timestamp
    : null;
}

function nextAuthEventTimestamp(previous = 0): number {
  const now = Date.now();
  const usablePrevious = Number.isSafeInteger(previous) && previous < now + 60_000
    ? previous
    : 0;
  return Math.max(now, usablePrevious + 1);
}

function getAuthChannel(): BroadcastChannel | null {
  if (
    typeof window === "undefined" ||
    typeof BroadcastChannel === "undefined" ||
    authChannelUnavailable
  ) {
    return null;
  }
  if (!authChannel) {
    try {
      authChannel = new BroadcastChannel(AUTH_SYNC_CHANNEL);
      authChannel.addEventListener("message", (event) => {
        const message = authSyncMessage(event.data);
        if (message?.type === "session-refreshed") {
          const refreshedAt = Number(message.refreshedAt);
          const observedAt = Number.isFinite(refreshedAt)
            ? refreshedAt
            : coordinationEpochClock();
          if (observedAt >= lastObservedRefreshAt) {
            lastObservedRefreshAt = observedAt;
            lastObservedRefreshGeneration =
              typeof message.generation === "string" ? message.generation : null;
          }
          return;
        }
        if (message?.type === "session-established") {
          const establishedAt = validSessionEstablishedAt(message.sessionEstablishedAt);
          if (establishedAt !== null && establishedAt >= lastObservedSessionEstablishedAt) {
            lastObservedSessionEstablishedAt = establishedAt;
            emitSessionEstablished(establishedAt, "peer");
          }
        }
      });
    } catch {
      authChannelUnavailable = true;
      authChannel = null;
    }
  }
  return authChannel;
}

function postAuthSyncMessage(message: AuthSyncMessage) {
  try {
    getAuthChannel()?.postMessage(message);
  } catch {
    // BroadcastChannel can be unavailable in restricted/private browser contexts. The
    // storage marker and bounded polling still coordinate when storage itself works.
  }
}

/** Tells this page and every peer that logout began or refresh was definitively rejected. */
export function broadcastSessionEnded(logoutRequestedAt?: number, sessionEndedAt?: number) {
  const message = { type: "session-ended", logoutRequestedAt, sessionEndedAt };
  postAuthSyncMessage(message);
  for (const handler of sessionEndedHandlers) {
    try {
      handler({ logoutRequestedAt, sessionEndedAt });
    } catch {
      // A UI observer must not turn session cleanup into a failed API request.
    }
  }
}

export function onSessionEnded(
  handler: (message: { logoutRequestedAt?: number; sessionEndedAt?: number }) => void
): () => void {
  sessionEndedHandlers.add(handler);
  const channel = getAuthChannel();
  if (!channel) return () => sessionEndedHandlers.delete(handler);
  const listener = (event: MessageEvent) => {
    const message = authSyncMessage(event.data);
    if (message?.type === "session-ended") {
      handler({
        logoutRequestedAt: message.logoutRequestedAt,
        sessionEndedAt: message.sessionEndedAt
      });
    }
  };
  try {
    channel.addEventListener("message", listener);
  } catch {
    return () => sessionEndedHandlers.delete(handler);
  }
  return () => {
    sessionEndedHandlers.delete(handler);
    try {
      channel.removeEventListener("message", listener);
    } catch {
      // The channel may already have been torn down by the browser.
    }
  };
}

/** Latest deliberate login/register generation observed locally or through shared storage. */
export function getLastSessionEstablishedAt(): number {
  if (typeof window !== "undefined") {
    try {
      const stored = validSessionEstablishedAt(
        window.localStorage.getItem(SESSION_ESTABLISHED_AT_KEY)
      );
      if (stored !== null && stored > lastObservedSessionEstablishedAt) {
        lastObservedSessionEstablishedAt = stored;
      }
    } catch {
      // Use the in-memory/BroadcastChannel observation in restricted contexts.
    }
  }
  return lastObservedSessionEstablishedAt;
}

function observeRefreshGeneration(): RefreshObservation {
  if (typeof window === "undefined") {
    return {
      refreshedAt: lastObservedRefreshAt,
      generation: lastObservedRefreshGeneration
    };
  }
  let storedRefreshAt = 0;
  let storedGeneration: string | null = null;
  try {
    storedRefreshAt = Number(window.localStorage.getItem(RECENT_REFRESH_KEY) ?? 0);
    storedGeneration = window.localStorage.getItem(RECENT_REFRESH_GENERATION_KEY);
  } catch {
    // Keep the in-memory/BroadcastChannel marker when localStorage is restricted.
  }
  const normalizedStoredAt = Number.isFinite(storedRefreshAt) ? storedRefreshAt : 0;
  if (normalizedStoredAt > lastObservedRefreshAt) {
    return { refreshedAt: normalizedStoredAt, generation: storedGeneration };
  }
  return {
    refreshedAt: lastObservedRefreshAt,
    generation: lastObservedRefreshGeneration
  };
}

function recentlyRefreshedElsewhere(beforeRequest: RefreshObservation) {
  const current = observeRefreshGeneration();
  const age = coordinationEpochClock() - current.refreshedAt;
  if (age < 0 || age >= RECENT_REFRESH_WINDOW_MS) return false;
  if (current.refreshedAt > beforeRequest.refreshedAt) return true;
  return Boolean(
    current.generation && current.generation !== beforeRequest.generation
  );
}

/** Fired on a successful silent refresh, so long-lived connections (the chat WebSocket) that don't go through apiFetch can notice their access-token cookie just changed and reconnect proactively instead of waiting to be dropped. */
export const AUTH_REFRESHED_EVENT = "auth-refreshed";

export function onAuthenticationRefreshed(handler: () => void): () => void {
  const channel = getAuthChannel();
  const channelListener = (event: MessageEvent) => {
    if (authSyncMessage(event.data)?.type === "session-refreshed") {
      handler();
    }
  };
  const windowListener = () => handler();
  try {
    channel?.addEventListener("message", channelListener);
  } catch {
    // The local window event remains available when BroadcastChannel is restricted.
  }
  if (typeof window !== "undefined") {
    window.addEventListener(AUTH_REFRESHED_EVENT, windowListener);
  }
  return () => {
    try {
      channel?.removeEventListener("message", channelListener);
    } catch {
      // The channel may already have been torn down by the browser.
    }
    if (typeof window !== "undefined") {
      window.removeEventListener(AUTH_REFRESHED_EVENT, windowListener);
    }
  };
}

function markRefreshed() {
  if (typeof window !== "undefined") {
    const refreshedAt = coordinationEpochClock();
    const generation = newCoordinationId();
    lastObservedRefreshAt = refreshedAt;
    lastObservedRefreshGeneration = generation;
    try {
      window.localStorage.setItem(RECENT_REFRESH_KEY, String(refreshedAt));
      window.localStorage.setItem(RECENT_REFRESH_GENERATION_KEY, generation);
    } catch {
      // A successful cookie rotation must remain successful in private/restricted mode.
    }
    window.dispatchEvent(new CustomEvent(AUTH_REFRESHED_EVENT));
    postAuthSyncMessage({ type: "session-refreshed", refreshedAt, generation });
  }
}

type RefreshOutcome = "ok" | "invalid" | "retry-later";

export type ServerLogoutOutcome =
  | "logout-confirmed"
  | "anonymous-unconfirmed"
  | "retry-later"
  | "cancelled";

async function performRefresh(
  beforeRequest: RefreshObservation,
  coordinationSignal?: AbortSignal
): Promise<RefreshOutcome> {
  // Another tab may have refreshed (and rotated the cookie) just before this one acquired
  // the lock - trust that instead of redeeming the now-already-rotated token ourselves.
  if (recentlyRefreshedElsewhere(beforeRequest)) return "ok";
  try {
    const response = await rawFetch("/auth/refresh", {
      method: "POST",
      signal: coordinationSignal
    });
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

/**
 * Attempts the cookie/session mutation for an explicit logout under the same cross-tab
 * boundary as refresh and login. The caller has already made the UI anonymous; this
 * function only reports whether the backend confirmed processing the presented logout
 * credentials, the browser is terminally anonymous without that confirmation, or a
 * durable retry is still required.
 */
export async function requestServerLogout(options: {
  signal?: AbortSignal;
  shouldProceed?: () => boolean;
} = {}): Promise<ServerLogoutOutcome> {
  const beforeRequest = observeRefreshGeneration();
  return runWithRefreshLock(async (coordinationSignal) => {
    if (options.shouldProceed && !options.shouldProceed()) return "cancelled";
    const requestOptions = withCoordinationSignal(
      { method: "POST", signal: options.signal },
      coordinationSignal
    );
    let response = await rawFetch("/auth/logout", requestOptions);
    if (response.ok) return "logout-confirmed";

    // The upgraded backend accepts an expired/revoked access cookie and revokes the
    // refresh record directly. During a rolling deploy an older backend can still answer
    // 401 first; refresh once inside this same lock, then retry logout without opening a
    // rotation race with another tab.
    if (response.status === 401) {
      // A bare 401 is not evidence that a still-present HttpOnly refresh credential was
      // revoked. Without CSRF we cannot safely redeem/check it, so retain the marker.
      if (!readCookie("csrf_token")) return "retry-later";
      const refreshOutcome = await performRefresh(
        beforeRequest,
        requestOptions.signal ?? undefined
      );
      if (refreshOutcome === "invalid") return "anonymous-unconfirmed";
      if (refreshOutcome !== "ok") return "retry-later";
      if (options.shouldProceed && !options.shouldProceed()) return "cancelled";
      response = await rawFetch("/auth/logout", requestOptions);
      if (response.ok) return "logout-confirmed";
    }

    // 403 (usually CSRF), 429 and every server failure leave the server-side state
    // unconfirmed. The pending marker must survive so an online/bootstrap retry can try
    // again; none of these statuses may be presented as successful revocation.
    return "retry-later";
  }, options.signal);
}

let localRefreshLockTail: Promise<void> = Promise.resolve();

let refreshTabId: string | null = null;

function newCoordinationId(): string {
  try {
    if (typeof globalThis.crypto?.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
  } catch {
    // Continue to the non-cryptographic uniqueness fallback below.
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function currentRefreshTabId(): string {
  refreshTabId ??= newCoordinationId();
  return refreshTabId;
}

function isRefreshLease(value: unknown): value is RefreshLease {
  if (!value || typeof value !== "object") return false;
  const lease = value as Partial<RefreshLease>;
  return (
    typeof lease.ownerId === "string" && lease.ownerId.length > 0 &&
    typeof lease.generation === "string" && lease.generation.length > 0 &&
    typeof lease.acquiredAt === "number" && Number.isFinite(lease.acquiredAt) &&
    typeof lease.expiresAt === "number" && Number.isFinite(lease.expiresAt) &&
    lease.expiresAt > lease.acquiredAt &&
    typeof lease.choosing === "boolean" &&
    typeof lease.holding === "boolean" &&
    typeof lease.ticket === "number" && Number.isSafeInteger(lease.ticket) &&
    lease.ticket >= 0 && (lease.choosing || lease.ticket > 0) &&
    !(lease.choosing && lease.holding)
  );
}

function browserLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function refreshLeaseStorageKey(ownerId: string): string {
  return `${REFRESH_LEASE_KEY_PREFIX}${encodeURIComponent(ownerId)}`;
}

function readRefreshLeaseByKey(key: string): {
  available: boolean;
  lease: RefreshLease | null;
} {
  const storage = browserLocalStorage();
  if (!storage) return { available: false, lease: null };
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return { available: false, lease: null };
  }
  if (!raw) return { available: true, lease: null };
  try {
    const parsed: unknown = JSON.parse(raw);
    return { available: true, lease: isRefreshLease(parsed) ? parsed : null };
  } catch {
    return { available: true, lease: null };
  }
}

function refreshLeaseKeys(storage: Storage): string[] {
  const keys: string[] = [];
  const keyCount = storage.length;
  for (let index = 0; index < keyCount; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(REFRESH_LEASE_KEY_PREFIX)) keys.push(key);
  }
  return keys.sort();
}

function sameStringArray(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function readRefreshLeases(): RefreshLeaseRead {
  const storage = browserLocalStorage();
  if (!storage) return { available: false, leases: [] };
  try {
    // Web Storage has atomic individual operations, not an atomic enumeration snapshot.
    // Validate membership around each read so index shifts cannot hide an active holder.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const keysBefore = refreshLeaseKeys(storage);
      const leases: RefreshLease[] = [];
      for (const key of keysBefore) {
        const raw = storage.getItem(key);
        if (!raw) continue;
        try {
          const parsed: unknown = JSON.parse(raw);
          if (isRefreshLease(parsed)) leases.push(parsed);
        } catch {
          // A malformed/stale coordination record is not an active claimant.
        }
      }
      const keysAfter = refreshLeaseKeys(storage);
      if (sameStringArray(keysBefore, keysAfter)) {
        return { available: true, leases };
      }
    }
    return { available: false, leases: [] };
  } catch {
    return { available: false, leases: [] };
  }
}

function writeRefreshLease(lease: RefreshLease): boolean {
  const storage = browserLocalStorage();
  if (!storage) return false;
  try {
    storage.setItem(refreshLeaseStorageKey(lease.ownerId), JSON.stringify(lease));
    return true;
  } catch {
    return false;
  }
}

function sameRefreshLease(left: RefreshLease | null | undefined, right: RefreshLease): boolean {
  return left?.ownerId === right.ownerId && left.generation === right.generation;
}

function randomBoundedDelay(minimum: number, maximum: number): number {
  const spread = maximum - minimum + 1;
  return minimum + Math.floor(Math.random() * spread);
}

function randomRefreshLeaseDelay(): number {
  return randomBoundedDelay(REFRESH_LEASE_RETRY_MIN_MS, REFRESH_LEASE_RETRY_MAX_MS);
}

function randomRefreshLeasePollDelay(): number {
  return randomBoundedDelay(REFRESH_LEASE_POLL_MIN_MS, REFRESH_LEASE_POLL_MAX_MS);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, milliseconds)));
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}

type CombinedAbortSignals = {
  signal: AbortSignal;
  dispose: () => void;
};

function combineAbortSignals(signals: AbortSignal[]): CombinedAbortSignals {
  const nativeAny = (AbortSignal as typeof AbortSignal & {
    any?: (signals: AbortSignal[]) => AbortSignal;
  }).any;
  if (typeof nativeAny === "function") {
    return { signal: nativeAny(signals), dispose: () => undefined };
  }

  const controller = new AbortController();
  const listeners = new Map<AbortSignal, () => void>();
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const [signal, listener] of listeners) {
      signal.removeEventListener("abort", listener);
    }
    listeners.clear();
  };
  const abortFrom = (signal: AbortSignal) => {
    if (!controller.signal.aborted) controller.abort(abortReason(signal));
    dispose();
  };
  for (const signal of signals) {
    if (signal.aborted) {
      abortFrom(signal);
      break;
    }
    const listener = () => abortFrom(signal);
    listeners.set(signal, listener);
    signal.addEventListener("abort", listener, { once: true });
  }
  return { signal: controller.signal, dispose };
}

function rejectWhenAborted<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", handleAbort, { once: true });
    if (signal.aborted) handleAbort();
    promise.then(
      (value) => {
        signal.removeEventListener("abort", handleAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", handleAbort);
        reject(error);
      }
    );
  });
}

function waitForRefreshLeaseChange(
  milliseconds: number,
  signal?: AbortSignal
): Promise<void> {
  if (typeof window === "undefined") return rejectWhenAborted(delay(milliseconds), signal);
  if (signal?.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    let settled = false;
    const channel = getAuthChannel();
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.removeEventListener("storage", onStorage);
      signal?.removeEventListener("abort", onAbort);
      try {
        channel?.removeEventListener("message", onMessage);
      } catch {
        // The timeout/polling path still completes the bounded wait.
      }
      if (error) reject(error);
      else resolve();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key.startsWith(REFRESH_LEASE_KEY_PREFIX)) finish();
    };
    const onMessage = (event: MessageEvent) => {
      const type = authSyncMessage(event.data)?.type;
      if (type === "refresh-lock-released" || type === "refresh-lock-changed") finish();
    };
    const onAbort = () => finish(signal ? abortReason(signal) : undefined);
    const timer = window.setTimeout(finish, Math.max(1, milliseconds));
    window.addEventListener("storage", onStorage);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    try {
      channel?.addEventListener("message", onMessage);
    } catch {
      // The timeout/storage-event paths remain available.
    }
  });
}

function coordinationClock(): number {
  try {
    return globalThis.performance?.now() ?? Date.now();
  } catch {
    return Date.now();
  }
}

function coordinationEpochClock(): number {
  try {
    const timeOrigin = globalThis.performance?.timeOrigin;
    const elapsed = globalThis.performance?.now();
    const timestamp = Number(timeOrigin) + Number(elapsed);
    if (Number.isFinite(timestamp) && timestamp > 0) return timestamp;
  } catch {
    // Use the wall clock only in runtimes without a high-resolution epoch clock.
  }
  return Date.now();
}

function leasePrecedes(left: RefreshLease, right: RefreshLease): boolean {
  if (left.ticket !== right.ticket) return left.ticket < right.ticket;
  if (left.ownerId !== right.ownerId) return left.ownerId < right.ownerId;
  return left.generation < right.generation;
}

async function acquireRefreshLease(
  callerSignal?: AbortSignal
): Promise<RefreshLeaseAcquisition> {
  if (callerSignal?.aborted) throw abortReason(callerSignal);
  const startedAt = coordinationClock();
  const remainingTime = () => Math.max(
    0,
    REFRESH_LEASE_ACQUIRE_TIMEOUT_MS - (coordinationClock() - startedAt)
  );
  const ownerId = currentRefreshTabId();
  const acquiredAt = coordinationEpochClock();
  const previousOwnLease = readRefreshLeaseByKey(refreshLeaseStorageKey(ownerId));
  if (!previousOwnLease.available) return { status: "unavailable" };
  if (
    previousOwnLease.lease &&
    previousOwnLease.lease.expiresAt > acquiredAt
  ) {
    // A prior aborted request from this tab may still be processed by the server. Never
    // overwrite its uncertainty fence with a new generation before the published TTL.
    return { status: "timed-out" };
  }
  if (previousOwnLease.lease) releaseRefreshLease(previousOwnLease.lease);
  let candidate: RefreshLease = {
    ownerId,
    acquiredAt,
    expiresAt: acquiredAt + REFRESH_LEASE_TTL_MS,
    generation: newCoordinationId(),
    choosing: true,
    holding: false,
    ticket: 0
  };
  let keepLease = false;

  // Lamport bakery: publish choosing=true before inspecting any contender. Every tab
  // owns a separate key, so no contender can overwrite or delete another tab's claim.
  if (!writeRefreshLease(candidate)) return { status: "unavailable" };
  postAuthSyncMessage({ type: "refresh-lock-changed", generation: candidate.generation });

  try {
    const initial = readRefreshLeases();
    if (!initial.available) return { status: "timed-out" };
    const now = coordinationEpochClock();
    const maximumTicket = initial.leases
      .filter((lease) => lease.expiresAt > now)
      .reduce((maximum, lease) => Math.max(maximum, lease.ticket), 0);
    if (maximumTicket >= Number.MAX_SAFE_INTEGER) {
      return { status: "timed-out" };
    }
    candidate = {
      ...candidate,
      expiresAt: now + REFRESH_LEASE_TTL_MS,
      choosing: false,
      holding: false,
      ticket: maximumTicket + 1
    };
    if (!writeRefreshLease(candidate)) return { status: "timed-out" };
    postAuthSyncMessage({ type: "refresh-lock-changed", generation: candidate.generation });

    let conflictFreeScans = 0;
    while (remainingTime() > 0) {
      if (callerSignal?.aborted) throw abortReason(callerSignal);
      const observed = readRefreshLeases();
      if (!observed.available) return { status: "timed-out" };
      const observedAt = coordinationEpochClock();
      const ownLease = observed.leases.find((lease) => sameRefreshLease(lease, candidate));
      if (!ownLease || ownLease.expiresAt <= observedAt) {
        return { status: "timed-out" };
      }

      const blockers = observed.leases.filter((lease) => (
        !sameRefreshLease(lease, candidate) &&
        lease.expiresAt > observedAt &&
        (lease.holding || lease.choosing || leasePrecedes(lease, candidate))
      ));
      if (blockers.length === 0) {
        conflictFreeScans += 1;
        if (conflictFreeScans >= 2) {
          candidate = { ...candidate, holding: true };
          if (!writeRefreshLease(candidate)) {
            return { status: "timed-out" };
          }
          postAuthSyncMessage({
            type: "refresh-lock-changed",
            generation: candidate.generation
          });
          let demoted = false;
          for (let confirmationScan = 0; confirmationScan < 2; confirmationScan += 1) {
            await waitForRefreshLeaseChange(Math.min(
              randomRefreshLeaseDelay(),
              Math.max(1, remainingTime())
            ), callerSignal);
            if (remainingTime() <= 0) return { status: "timed-out" };
            const confirmation = readRefreshLeases();
            if (!confirmation.available) return { status: "timed-out" };
            const confirmedAt = coordinationEpochClock();
            const ownConfirmation = confirmation.leases.find((lease) => (
              sameRefreshLease(lease, candidate) &&
              lease.holding &&
              lease.expiresAt > confirmedAt
            ));
            if (!ownConfirmation) return { status: "timed-out" };
            const competingHolder = confirmation.leases.some((lease) => (
              !sameRefreshLease(lease, candidate) &&
              lease.holding &&
              lease.expiresAt > confirmedAt
            ));
            if (competingHolder) {
              candidate = { ...candidate, holding: false };
              if (!writeRefreshLease(candidate)) {
                return { status: "timed-out" };
              }
              postAuthSyncMessage({
                type: "refresh-lock-changed",
                generation: candidate.generation
              });
              conflictFreeScans = 0;
              demoted = true;
              break;
            }
          }
          if (demoted) continue;
          keepLease = true;
          return { status: "acquired", lease: candidate };
        }
        await waitForRefreshLeaseChange(Math.min(
          randomRefreshLeaseDelay(),
          Math.max(1, remainingTime())
        ), callerSignal);
        continue;
      }

      conflictFreeScans = 0;
      const nearestExpiry = Math.min(...blockers.map((lease) => lease.expiresAt));
      const untilExpiry = Math.max(1, nearestExpiry - observedAt);
      await waitForRefreshLeaseChange(Math.min(
        randomRefreshLeasePollDelay(),
        untilExpiry,
        Math.max(1, remainingTime())
      ), callerSignal);
    }
    return { status: "timed-out" };
  } finally {
    if (!keepLease) releaseRefreshLease(candidate);
  }
}

function releaseRefreshLease(lease: RefreshLease) {
  const key = refreshLeaseStorageKey(lease.ownerId);
  const current = readRefreshLeaseByKey(key);
  if (!current.available || !sameRefreshLease(current.lease, lease)) return;
  const storage = browserLocalStorage();
  if (!storage) return;
  try {
    // Only this tab writes this key. The generation check prevents a delayed finally
    // from removing a newer attempt made by the same tab.
    const latest = readRefreshLeaseByKey(key);
    if (!latest.available || !sameRefreshLease(latest.lease, lease)) return;
    storage.removeItem(key);
    postAuthSyncMessage({ type: "refresh-lock-released", generation: lease.generation });
  } catch {
    // The bounded TTL makes an unreleased lease recoverable.
  }
}

function releaseRefreshLeaseAfterExpiry(lease: RefreshLease) {
  const current = readRefreshLeaseByKey(refreshLeaseStorageKey(lease.ownerId));
  if (!current.available || !sameRefreshLease(current.lease, lease) || !current.lease) return;
  const delayUntilExpiry = Math.max(
    1,
    current.lease.expiresAt - coordinationEpochClock() + 1
  );
  setTimeout(() => releaseRefreshLease(lease), delayUntilExpiry);
}

type RefreshOperationGuard = {
  signal: AbortSignal;
  stop: () => void;
};

function startRefreshOperationGuard(lease?: RefreshLease): RefreshOperationGuard {
  const controller = new AbortController();
  let stopped = false;
  let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  const operationTimer = setTimeout(() => {
    stopped = true;
    if (heartbeatTimer !== null) clearTimeout(heartbeatTimer);
    controller.abort(new RefreshCoordinationTimeoutError());
  }, REFRESH_OPERATION_TIMEOUT_MS);
  const renew = () => {
    if (stopped || !lease) return;
    const key = refreshLeaseStorageKey(lease.ownerId);
    const current = readRefreshLeaseByKey(key);
    const now = coordinationEpochClock();
    if (
      !current.available ||
      !sameRefreshLease(current.lease, lease) ||
      !current.lease ||
      current.lease.expiresAt <= now
    ) {
      stopped = true;
      controller.abort(new RefreshCoordinationUnavailableError());
      return;
    }
    if (!writeRefreshLease({ ...current.lease, expiresAt: now + REFRESH_LEASE_TTL_MS })) {
      stopped = true;
      controller.abort(new RefreshCoordinationUnavailableError());
      return;
    }
    heartbeatTimer = setTimeout(renew, REFRESH_LEASE_HEARTBEAT_MS);
  };
  if (lease) heartbeatTimer = setTimeout(renew, REFRESH_LEASE_HEARTBEAT_MS);
  return {
    signal: controller.signal,
    stop: () => {
    // renew() is synchronous: after stopped is set and this timer is cleared, no late
    // heartbeat can recreate the key after release.
      stopped = true;
      clearTimeout(operationTimer);
      if (heartbeatTimer !== null) clearTimeout(heartbeatTimer);
    }
  };
}

function rejectAfter<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new RefreshCoordinationTimeoutError()),
      milliseconds
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function runWithLocalPageLock<T>(
  operation: () => Promise<T>,
  callerSignal?: AbortSignal
): Promise<T> {
  const previous = localRefreshLockTail;
  let release!: () => void;
  let acquired = false;
  localRefreshLockTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await rejectAfter(
      rejectWhenAborted(previous, callerSignal),
      REFRESH_LEASE_ACQUIRE_TIMEOUT_MS
    );
    acquired = true;
    return await operation();
  } finally {
    if (acquired) {
      release();
    } else {
      // A timed-out waiter must not punch a hole in the queue. Its caller is released,
      // but its tail opens only after the actual predecessor eventually finishes.
      void previous.then(release, release);
    }
  }
}

type RefreshOperation<T> = (signal?: AbortSignal) => Promise<T>;

async function runGuardedRefreshOperation<T>(
  operation: RefreshOperation<T>,
  lease?: RefreshLease,
  onCoordinationAbort?: () => void,
  callerSignal?: AbortSignal
): Promise<T> {
  const guard = startRefreshOperationGuard(lease);
  const combinedSignals = callerSignal
    ? combineAbortSignals([guard.signal, callerSignal])
    : null;
  const operationSignal = combinedSignals?.signal ?? guard.signal;
  try {
    // Do not release the lease merely because abort was requested. fetch() may already
    // have reached the server; wait for its actual promise to settle before leaving the
    // coordination boundary.
    return await operation(operationSignal);
  } finally {
    if (operationSignal.aborted) onCoordinationAbort?.();
    combinedSignals?.dispose();
    guard.stop();
  }
}

async function runWithRefreshLease<T>(
  operation: RefreshOperation<T>,
  callerSignal?: AbortSignal
): Promise<T> {
  const acquisition = await acquireRefreshLease(callerSignal);
  if (acquisition.status === "unavailable") {
    let coordinationAborted = false;
    try {
      return await runGuardedRefreshOperation(
        operation,
        undefined,
        () => {
          coordinationAborted = true;
        },
        callerSignal
      );
    } finally {
      if (coordinationAborted) {
        // With storage unavailable there is no durable claim to publish. Keep the
        // Web Lock/local queue itself closed for the same uncertainty window so a late
        // Set-Cookie response cannot race a new login in this coordination domain.
        await delay(REFRESH_LEASE_TTL_MS);
      }
    }
  }
  if (acquisition.status === "timed-out") throw new RefreshCoordinationTimeoutError();
  let coordinationAborted = false;
  try {
    return await runGuardedRefreshOperation(
      operation,
      acquisition.lease,
      () => {
        coordinationAborted = true;
      },
      callerSignal
    );
  } finally {
    if (coordinationAborted) {
      // An abort can race a request already being processed by the server. Keep the
      // claim as a short uncertainty fence, stop renewing it, then compare-and-release
      // only after its last published TTL expires.
      releaseRefreshLeaseAfterExpiry(acquisition.lease);
    } else {
      releaseRefreshLease(acquisition.lease);
    }
  }
}

async function runWithRefreshLock<T>(
  operation: RefreshOperation<T>,
  callerSignal?: AbortSignal
): Promise<T> {
  if (typeof navigator === "undefined") return operation();

  return runWithLocalPageLock(async () => {
    if (typeof navigator.locks?.request === "function") {
      let callbackStarted = false;
      const lockWaitController = new AbortController();
      const lockWaitTimer = setTimeout(
        () => lockWaitController.abort(new RefreshCoordinationTimeoutError()),
        REFRESH_LEASE_ACQUIRE_TIMEOUT_MS
      );
      const combinedLockSignals = callerSignal
        ? combineAbortSignals([lockWaitController.signal, callerSignal])
        : null;
      const lockWaitSignal = combinedLockSignals?.signal ?? lockWaitController.signal;
      try {
        return await navigator.locks.request(
          REFRESH_LOCK_NAME,
          { signal: lockWaitSignal },
          async () => {
            callbackStarted = true;
            clearTimeout(lockWaitTimer);
            // Also publish the storage claim. This bridges the lock domain if another
            // tab lacks Web Locks while sharing the same cookies/localStorage.
            return runWithRefreshLease(operation, callerSignal);
          }
        );
      } catch (error) {
        if (callbackStarted) throw error;
        if (callerSignal?.aborted) throw abortReason(callerSignal);
        if (lockWaitController.signal.aborted) {
          throw new RefreshCoordinationTimeoutError();
        }
        // Never fall through into a different lock domain after Web Locks rejected the
        // request: another tab may still hold the real Web Lock.
        throw new RefreshCoordinationUnavailableError();
      } finally {
        combinedLockSignals?.dispose();
        clearTimeout(lockWaitTimer);
      }
    }
    // Web Locks is restricted to secure contexts, while the Docker E2E origin is plain
    // HTTP. The per-tab storage bakery is the cross-tab fallback; if storage itself is
    // restricted, this module's in-page queue remains the final safe fallback.
    return runWithRefreshLease(operation, callerSignal);
  }, callerSignal);
}

async function runExclusiveRefresh(
  beforeRequest: RefreshObservation
): Promise<RefreshOutcome> {
  try {
    return await runWithRefreshLock(async (signal) => {
      const outcome = await performRefresh(beforeRequest, signal);
      if (outcome === "invalid") {
        // Publish while the cookie-mutation lock is still held. The timestamp lets a
        // peer ignore delayed delivery if a deliberate newer login wins afterward.
        const sessionEndedAt = nextAuthEventTimestamp(getLastSessionEstablishedAt());
        broadcastSessionEnded(undefined, sessionEndedAt);
      }
      return outcome;
    });
  } catch (error) {
    if (
      error instanceof RefreshCoordinationTimeoutError ||
      error instanceof RefreshCoordinationUnavailableError
    ) {
      return "retry-later";
    }
    throw error;
  }
}

let refreshInFlight: Promise<RefreshOutcome> | null = null;

function refreshSession(beforeRequest: RefreshObservation): Promise<RefreshOutcome> {
  if (!refreshInFlight) {
    refreshInFlight = runExclusiveRefresh(beforeRequest).finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

function withCoordinationSignal(
  options: RequestInit,
  coordinationSignal?: AbortSignal
): RequestInit {
  if (!coordinationSignal) return options;
  return {
    ...options,
    // runWithRefreshLock already folded options.signal into this guarded signal.
    signal: coordinationSignal
  };
}

export async function apiFetch<T>(path: string, options: RequestInit = {}, isRetry = false): Promise<T> {
  const refreshBeforeRequest = observeRefreshGeneration();
  const normalizedPath = path.split("?", 1)[0];
  const coordinatesSessionRotation = SESSION_ROTATING_PATHS.has(normalizedPath);
  const response = coordinatesSessionRotation
      ? await runWithRefreshLock(async (signal) => {
        const rotatingResponse = await rawFetch(
          path,
          withCoordinationSignal(options, signal)
        );
        // Publish the new cookie generation before releasing the same cross-tab lock
        // used by refresh. A stale request that received 401 while this mutation was
        // in flight will then retry with the new session instead of redeeming and
        // clearing the just-rotated refresh cookie.
        if (rotatingResponse.headers.get("X-Session-Rotated") === "true") {
          if (SESSION_ESTABLISHING_PATHS.has(normalizedPath)) {
            notifySessionEstablished();
          }
          markRefreshed();
        }
        return rotatingResponse;
      }, options.signal ?? undefined)
    : await rawFetch(path, options);

  if (!response.ok) {
    // Only a previously-established session (csrf cookie present) is worth refreshing;
    // an anonymous 401 (e.g. /auth/me for a logged-out visitor) should just fail quietly.
    if (response.status === 401 && !isRetry && path !== "/auth/refresh" && readCookie("csrf_token")) {
      const outcome = await refreshSession(refreshBeforeRequest);
      if (outcome === "ok") return apiFetch<T>(path, options, true);
      if (outcome === "invalid") {
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

  if (
    !coordinatesSessionRotation &&
    response.headers.get("X-Session-Rotated") === "true"
  ) {
    markRefreshed();
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
