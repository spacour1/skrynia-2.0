"use client";

import { create } from "zustand";
import * as Sentry from "@sentry/nextjs";
import {
  ApiError,
  apiFetch,
  broadcastSessionEnded,
  getLastSessionEstablishedAt,
  onSessionEnded,
  onSessionEstablished,
  requestServerLogout,
  type User
} from "./api";

export type AuthStatus = "unknown" | "authenticated" | "anonymous" | "degraded";

export type AuthState = {
  user: User | null;
  status: AuthStatus;
  // Kept for compatibility with existing consumers while they migrate to `status`.
  hydrated: boolean;
  establishSession: (user: User) => void;
  setUser: (user: User) => void;
  setAuthenticated: (user: User) => void;
  setAnonymous: () => void;
  setDegraded: () => void;
  logout: () => Promise<void>;
  hydrate: () => Promise<AuthStatus>;
};

// Holds only non-sensitive profile fields (no tokens - those stay in httpOnly cookies).
// A cold boot never installs this cache into auth state until /auth/me has confirmed the
// session; logout still removes it immediately so it cannot survive an offline sign-out.
const CACHED_USER_KEY = "auth_cached_user";
export const PENDING_LOGOUT_STORAGE_KEY = "auth_pending_logout";
export const PENDING_LOGOUT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const LOGOUT_REQUEST_TIMEOUT_MS = 10_000;

type PendingLogoutMarker = {
  requestedAt: number;
  attempts: number;
  state: "pending-server-logout";
};

let memoryPendingLogout: PendingLogoutMarker | null = null;
let lastLogoutRequestedAt = 0;
let pendingLogoutStorageUnavailable = false;

function usableRecentTimestamp(value: number, now = Date.now()): number {
  return Number.isSafeInteger(value) && value > 0 && value < now + 60_000 ? value : 0;
}

function lastKnownSessionEstablishedAt(): number {
  return usableRecentTimestamp(getLastSessionEstablishedAt());
}

function browserLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    const storage = window.localStorage;
    if (!storage) pendingLogoutStorageUnavailable = true;
    return storage;
  } catch {
    pendingLogoutStorageUnavailable = true;
    return null;
  }
}

function removeCachedUserFromStorage(storage = browserLocalStorage()) {
  if (!storage) return;
  try {
    storage.removeItem(CACHED_USER_KEY);
  } catch {
    // Local anonymous state must still win when storage is restricted or full.
  }
}

function parsePendingLogoutMarker(raw: string, now: number): PendingLogoutMarker | null {
  try {
    const parsed = JSON.parse(raw) as Partial<PendingLogoutMarker>;
    const keys = Object.keys(parsed).sort();
    if (
      keys.length !== 3 ||
      keys[0] !== "attempts" ||
      keys[1] !== "requestedAt" ||
      keys[2] !== "state" ||
      parsed.state !== "pending-server-logout" ||
      !Number.isFinite(parsed.requestedAt) ||
      !Number.isInteger(parsed.requestedAt) ||
      !Number.isInteger(parsed.attempts) ||
      (parsed.attempts ?? -1) < 0 ||
      (parsed.attempts ?? 0) > Number.MAX_SAFE_INTEGER ||
      (parsed.requestedAt ?? 0) <= 0 ||
      (parsed.requestedAt ?? 0) > now + 60_000 ||
      now - (parsed.requestedAt ?? 0) > PENDING_LOGOUT_TTL_MS
    ) {
      return null;
    }
    return parsed as PendingLogoutMarker;
  } catch {
    return null;
  }
}

function readMemoryPendingLogout(): PendingLogoutMarker | null {
  if (!memoryPendingLogout) return null;
  const marker = parsePendingLogoutMarker(
    JSON.stringify(memoryPendingLogout),
    Date.now()
  );
  if (!marker) memoryPendingLogout = null;
  if (marker && lastKnownSessionEstablishedAt() > marker.requestedAt) {
    memoryPendingLogout = null;
    return null;
  }
  return marker;
}

function readPendingLogoutMarker(): PendingLogoutMarker | null {
  const storage = browserLocalStorage();
  if (!storage) return readMemoryPendingLogout();
  try {
    const raw = storage.getItem(PENDING_LOGOUT_STORAGE_KEY);
    if (!raw) {
      const memoryMarker = readMemoryPendingLogout();
      if (memoryMarker && pendingLogoutStorageUnavailable) {
        try {
          storage.setItem(
            PENDING_LOGOUT_STORAGE_KEY,
            JSON.stringify(memoryMarker)
          );
          pendingLogoutStorageUnavailable = false;
        } catch {
          return readMemoryPendingLogout();
        }
        return readMemoryPendingLogout();
      }
      pendingLogoutStorageUnavailable = false;
      memoryPendingLogout = null;
      return null;
    }
    const marker = parsePendingLogoutMarker(raw, Date.now());
    if (!marker) {
      memoryPendingLogout = null;
      try {
        storage.removeItem(PENDING_LOGOUT_STORAGE_KEY);
        pendingLogoutStorageUnavailable = false;
      } catch {
        pendingLogoutStorageUnavailable = true;
      }
      removeCachedUserFromStorage(storage);
      return null;
    }
    if (lastKnownSessionEstablishedAt() > marker.requestedAt) {
      memoryPendingLogout = null;
      try {
        storage.removeItem(PENDING_LOGOUT_STORAGE_KEY);
        pendingLogoutStorageUnavailable = false;
      } catch {
        pendingLogoutStorageUnavailable = true;
      }
      return null;
    }
    memoryPendingLogout = marker;
    pendingLogoutStorageUnavailable = false;
    return marker;
  } catch {
    pendingLogoutStorageUnavailable = true;
    return readMemoryPendingLogout();
  }
}

function writePendingLogoutMarker(marker: PendingLogoutMarker) {
  memoryPendingLogout = marker;
  const storage = browserLocalStorage();
  if (!storage) return;
  try {
    storage.setItem(PENDING_LOGOUT_STORAGE_KEY, JSON.stringify(marker));
    pendingLogoutStorageUnavailable = false;
  } catch {
    pendingLogoutStorageUnavailable = true;
    // Keep the same-page memory fallback; UI logout must never depend on storage access.
  }
}

function clearPendingLogoutMarker(expectedRequestedAt?: number) {
  if (
    expectedRequestedAt === undefined ||
    memoryPendingLogout?.requestedAt === expectedRequestedAt
  ) {
    memoryPendingLogout = null;
  }
  const storage = browserLocalStorage();
  if (!storage) return;
  try {
    if (expectedRequestedAt !== undefined) {
      const raw = storage.getItem(PENDING_LOGOUT_STORAGE_KEY);
      if (raw) {
        const stored = parsePendingLogoutMarker(raw, Date.now());
        if (stored?.requestedAt !== expectedRequestedAt) return;
      }
    }
    storage.removeItem(PENDING_LOGOUT_STORAGE_KEY);
    pendingLogoutStorageUnavailable = false;
  } catch {
    pendingLogoutStorageUnavailable = true;
    // The memory copy was still cleared; a valid persisted copy remains fail-safe.
  }
}

function ensurePendingLogoutMarker(): PendingLogoutMarker {
  const existing = readPendingLogoutMarker();
  if (existing) return existing;
  const now = Date.now();
  const requestedAt = Math.max(
    now,
    usableRecentTimestamp(lastLogoutRequestedAt, now) + 1,
    usableRecentTimestamp(lastAuthenticatedAt, now) + 1,
    lastKnownSessionEstablishedAt() + 1
  );
  lastLogoutRequestedAt = requestedAt;
  const marker: PendingLogoutMarker = {
    requestedAt,
    attempts: 0,
    state: "pending-server-logout"
  };
  writePendingLogoutMarker(marker);
  return marker;
}

function pendingLogoutMatches(requestedAt: number) {
  return readPendingLogoutMarker()?.requestedAt === requestedAt;
}

function isValidPeerEventTimestamp(timestamp: number): boolean {
  return Number.isSafeInteger(timestamp) &&
    timestamp > 0 &&
    timestamp <= Date.now() + 60_000;
}

function retainPeerPendingLogout(requestedAt: number): boolean {
  if (!isValidPeerEventTimestamp(requestedAt)) return false;
  const current = readPendingLogoutMarker();
  if (current && current.requestedAt >= requestedAt) return false;
  lastLogoutRequestedAt = Math.max(lastLogoutRequestedAt, requestedAt);
  writePendingLogoutMarker({
    requestedAt,
    attempts: 0,
    state: "pending-server-logout"
  });
  return true;
}

export function readCachedUser(): User | null {
  if (typeof window === "undefined") return null;
  if (readPendingLogoutMarker()) {
    removeCachedUserFromStorage();
    return null;
  }
  try {
    const raw = window.localStorage.getItem(CACHED_USER_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isUser(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeCachedUser(user: User | null) {
  const storage = browserLocalStorage();
  if (!storage) return;
  try {
    if (user) storage.setItem(CACHED_USER_KEY, JSON.stringify(user));
    else storage.removeItem(CACHED_USER_KEY);
  } catch {
    // Zustand remains authoritative when persistent storage is unavailable.
  }
}

function isUser(value: unknown): value is User {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<User>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.email === "string" &&
    typeof candidate.displayName === "string" &&
    (candidate.role === "user" || candidate.role === "moderator" || candidate.role === "admin")
  );
}

function isDefinitiveAnonymous(error: unknown) {
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
}

let hydrationInFlight: Promise<AuthStatus> | null = null;
let authStateEpoch = 0;
let lastAuthenticatedAt = 0;
let pendingLogoutRetryInFlight: Promise<void> | null = null;
let pendingLogoutRetryQueued = false;

export function hasPendingLogout(): boolean {
  return readPendingLogoutMarker() !== null;
}

export function retryPendingLogout(
  options: { queueIfInFlight?: boolean } = {}
): Promise<void> {
  if (pendingLogoutRetryInFlight) {
    if (options.queueIfInFlight) pendingLogoutRetryQueued = true;
    return pendingLogoutRetryInFlight;
  }
  const marker = readPendingLogoutMarker();
  if (!marker) return Promise.resolve();

  const attemptedMarker: PendingLogoutMarker = {
    ...marker,
    attempts: Math.min(Number.MAX_SAFE_INTEGER, marker.attempts + 1)
  };
  writePendingLogoutMarker(attemptedMarker);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LOGOUT_REQUEST_TIMEOUT_MS);

  pendingLogoutRetryInFlight = (async () => {
    try {
      const outcome = await requestServerLogout({
        signal: controller.signal,
        shouldProceed: () => pendingLogoutMatches(marker.requestedAt)
      });
      if (outcome === "logout-confirmed" || outcome === "anonymous-unconfirmed") {
        clearPendingLogoutMarker(marker.requestedAt);
      }
      // retry-later and transport/timeout failures intentionally retain the marker.
      // "anonymous-unconfirmed" clears local retry state but is never described as a
      // confirmed server revocation to callers or telemetry.
    } catch {
      // Offline, aborted and coordination failures are expected recovery states.
    } finally {
      clearTimeout(timeout);
    }
  })().finally(() => {
    pendingLogoutRetryInFlight = null;
    const shouldRetry = pendingLogoutRetryQueued;
    pendingLogoutRetryQueued = false;
    if (shouldRetry && readPendingLogoutMarker()) {
      void retryPendingLogout();
    }
  });
  return pendingLogoutRetryInFlight;
}

export function startPendingLogoutRecovery(): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handleOnline = () => {
    void retryPendingLogout({ queueIfInFlight: true });
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== PENDING_LOGOUT_STORAGE_KEY) return;
    const previousGeneration = event.oldValue
      ? parsePendingLogoutMarker(event.oldValue, Date.now())?.requestedAt
      : undefined;
    const nextGeneration = event.newValue
      ? parsePendingLogoutMarker(event.newValue, Date.now())?.requestedAt
      : undefined;
    // Updating the safe attempts counter also emits a storage event in peer tabs. Only
    // a newly-created/different logout generation is a failover signal; otherwise two
    // offline tabs could ping-pong retries forever.
    if (nextGeneration === undefined || nextGeneration === previousGeneration) return;
    const marker = readPendingLogoutMarker();
    if (marker?.requestedAt === nextGeneration) {
      useAuth.getState().setAnonymous();
      void retryPendingLogout({ queueIfInFlight: true });
    }
  };
  window.addEventListener("online", handleOnline);
  window.addEventListener("storage", handleStorage);
  if (readPendingLogoutMarker()) {
    useAuth.getState().setAnonymous();
    void retryPendingLogout();
  }
  return () => {
    window.removeEventListener("online", handleOnline);
    window.removeEventListener("storage", handleStorage);
  };
}

export const useAuth = create<AuthState>((set, get) => {
  const applyAuthenticated = (user: User, establishesNewSession: boolean) => {
    authStateEpoch += 1;
    if (establishesNewSession) {
      lastAuthenticatedAt = Date.now();
      clearPendingLogoutMarker();
    }
    writeCachedUser(user);
    Sentry.setUser({ id: user.id, segment: user.role });
    set({ user, status: "authenticated", hydrated: true });
  };
  const setAuthenticated = (user: User) => applyAuthenticated(user, true);
  const updateAuthenticatedUser = (user: User) => {
    // Profile/avatar mutations may settle after logout. They can update an existing
    // authenticated/degraded session, but they must never resurrect anonymous state or
    // cancel a pending server logout. Login/register use establishSession explicitly.
    const current = get();
    if (
      current.status === "anonymous" ||
      !current.user ||
      current.user.id !== user.id ||
      readPendingLogoutMarker()
    ) {
      if (readPendingLogoutMarker()) setAnonymous();
      return;
    }
    applyAuthenticated(user, false);
  };

  const setAnonymous = () => {
    authStateEpoch += 1;
    writeCachedUser(null);
    Sentry.setUser(null);
    set({ user: null, status: "anonymous", hydrated: true });
  };

  const setDegraded = () => {
    authStateEpoch += 1;
    // A transport failure may retain an identity already confirmed in this page, but it
    // must never promote a cold-start localStorage profile into authenticated UI before
    // the server check succeeds.
    const retainedUser = get().user;
    if (retainedUser) Sentry.setUser({ id: retainedUser.id, segment: retainedUser.role });
    else Sentry.setUser(null);
    set({ user: retainedUser, status: "degraded", hydrated: true });
  };

  const hydrate = () => {
    if (readPendingLogoutMarker()) {
      setAnonymous();
      void retryPendingLogout();
      return Promise.resolve("anonymous" as const);
    }
    if (!hydrationInFlight) {
      const hydrationEpoch = authStateEpoch;
      hydrationInFlight = (async () => {
        try {
          const response = await apiFetch<{ user: unknown }>("/auth/me");
          if (!isUser(response.user)) throw new Error("Invalid auth response");
          // A definitive logout or a newer login may have changed auth state while
          // /auth/me was in flight. Never let that stale response overwrite it.
          if (hydrationEpoch !== authStateEpoch || readPendingLogoutMarker()) {
            if (readPendingLogoutMarker()) setAnonymous();
            return get().status;
          }
          // /auth/me confirms an existing session; unlike an explicit login/register it
          // must not make a delayed pre-logout response newer than session-ended.
          applyAuthenticated(response.user, false);
          return "authenticated" as const;
        } catch (error) {
          if (hydrationEpoch !== authStateEpoch || readPendingLogoutMarker()) {
            if (readPendingLogoutMarker()) setAnonymous();
            return get().status;
          }
          if (isDefinitiveAnonymous(error)) {
            setAnonymous();
            return "anonymous" as const;
          }
          setDegraded();
          return "degraded" as const;
        }
      })().finally(() => {
        hydrationInFlight = null;
      });
    }
    return hydrationInFlight;
  };

  return {
    // Starts neutral until /auth/me confirms the cookie-backed server session.
    user: null,
    status: "unknown",
    hydrated: false,
    establishSession: setAuthenticated,
    setUser: updateAuthenticatedUser,
    setAuthenticated,
    setAnonymous,
    setDegraded,
    logout: async () => {
      const marker = ensurePendingLogoutMarker();
      setAnonymous();
      broadcastSessionEnded(marker.requestedAt);
      await retryPendingLogout();
    },
    hydrate
  };
});

// A logout (or a definitively-rejected refresh) in one tab must sign every other open tab
// out too - cookies are shared, so leaving another tab's cached user in place would just
// let it keep showing a "logged in" UI against a session that no longer exists server-side.
if (typeof window !== "undefined") {
  onSessionEstablished((establishedAt, source) => {
    const pendingLogout = readPendingLogoutMarker();
    if (
      source === "peer" &&
      pendingLogout &&
      pendingLogout.requestedAt >= establishedAt
    ) {
      // BroadcastChannel delivery can be delayed. A login generation older than the
      // current logout claim must not erase that claim or rehydrate stale shared cookies.
      return;
    }
    // This callback runs before apiFetch releases the same cross-tab lock used by a
    // queued pending logout, so the queued attempt sees no marker and cannot revoke the
    // freshly issued login/register cookies.
    lastAuthenticatedAt = Math.max(lastAuthenticatedAt, establishedAt);
    clearPendingLogoutMarker(pendingLogout?.requestedAt);
    if (source === "peer") {
      // Shared cookies may now belong to a different account. Remove the old identity
      // and its QueryClient synchronously, then ask the server which user owns the new
      // session. A pre-existing hydrate is allowed to settle before one bounded retry.
      useAuth.getState().setAnonymous();
      void useAuth.getState().hydrate().then((status) => {
        if (status === "anonymous" && !hasPendingLogout()) {
          void useAuth.getState().hydrate();
        }
      });
    }
  });
  onSessionEnded(({ logoutRequestedAt, sessionEndedAt } = {}) => {
    if (
      (logoutRequestedAt !== undefined && !isValidPeerEventTimestamp(logoutRequestedAt)) ||
      (sessionEndedAt !== undefined && !isValidPeerEventTimestamp(sessionEndedAt))
    ) {
      return;
    }
    const endedAt = logoutRequestedAt ?? sessionEndedAt;
    if (
      endedAt !== undefined &&
      Math.max(
        usableRecentTimestamp(lastAuthenticatedAt),
        lastKnownSessionEstablishedAt()
      ) > endedAt
    ) {
      // A deliberate login/register in any tab supersedes this older logout generation.
      // Clear a matching memory-only marker as well so it cannot retry against new cookies.
      if (logoutRequestedAt !== undefined) clearPendingLogoutMarker(logoutRequestedAt);
      return;
    }
    if (logoutRequestedAt !== undefined) {
      // The initiating tab may be in private/restricted storage mode. Persist the safe
      // timestamp-only marker from BroadcastChannel here so a surviving peer can still
      // retry after that initiating tab closes.
      const retained = retainPeerPendingLogout(logoutRequestedAt);
      useAuth.getState().setAnonymous();
      if (retained) void retryPendingLogout({ queueIfInFlight: true });
      return;
    }
    useAuth.getState().setAnonymous();
  });
}
