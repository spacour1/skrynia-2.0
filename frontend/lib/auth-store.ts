"use client";

import { create } from "zustand";
import * as Sentry from "@sentry/nextjs";
import {
  ApiError,
  apiFetch,
  broadcastSessionEnded,
  onSessionEnded,
  type User
} from "./api";

export type AuthStatus = "unknown" | "authenticated" | "anonymous" | "degraded";

export type AuthState = {
  user: User | null;
  status: AuthStatus;
  // Kept for compatibility with existing consumers while they migrate to `status`.
  hydrated: boolean;
  setUser: (user: User) => void;
  setAuthenticated: (user: User) => void;
  setAnonymous: () => void;
  setDegraded: () => void;
  logout: () => Promise<void>;
  hydrate: () => Promise<AuthStatus>;
};

// Holds only non-sensitive profile fields (no tokens - those stay in httpOnly cookies) so
// the nav bar can render the logged-in UI immediately on page load instead of flashing
// "logged out" for the round trip hydrate() needs to confirm the session via /auth/me.
const CACHED_USER_KEY = "auth_cached_user";

export function readCachedUser(): User | null {
  if (typeof window === "undefined") return null;
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
  if (typeof window === "undefined") return;
  if (user) window.localStorage.setItem(CACHED_USER_KEY, JSON.stringify(user));
  else window.localStorage.removeItem(CACHED_USER_KEY);
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

export const useAuth = create<AuthState>((set, get) => {
  const setAuthenticated = (user: User) => {
    writeCachedUser(user);
    Sentry.setUser({ id: user.id, segment: user.role });
    set({ user, status: "authenticated", hydrated: true });
  };

  const setAnonymous = () => {
    writeCachedUser(null);
    Sentry.setUser(null);
    set({ user: null, status: "anonymous", hydrated: true });
  };

  const setDegraded = () => {
    const retainedUser = get().user ?? readCachedUser();
    if (retainedUser) Sentry.setUser({ id: retainedUser.id, segment: retainedUser.role });
    else Sentry.setUser(null);
    set({ user: retainedUser, status: "degraded", hydrated: true });
  };

  const hydrate = () => {
    if (!hydrationInFlight) {
      hydrationInFlight = (async () => {
        try {
          const response = await apiFetch<{ user: unknown }>("/auth/me");
          if (!isUser(response.user)) throw new Error("Invalid auth response");
          setAuthenticated(response.user);
          return "authenticated" as const;
        } catch (error) {
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
    // Starts null (not readCachedUser()) so this matches Next's server-rendered markup -
    // the cache is applied client-side from a layout effect in Providers instead, which runs
    // before paint and so avoids both a hydration mismatch and a visible logged-out flash.
    user: null,
    status: "unknown",
    hydrated: false,
    setUser: setAuthenticated,
    setAuthenticated,
    setAnonymous,
    setDegraded,
    logout: async () => {
      try {
        await apiFetch("/auth/logout", { method: "POST" });
      } finally {
        setAnonymous();
        broadcastSessionEnded();
      }
    },
    hydrate
  };
});

// A logout (or a definitively-rejected refresh) in one tab must sign every other open tab
// out too - cookies are shared, so leaving another tab's cached user in place would just
// let it keep showing a "logged in" UI against a session that no longer exists server-side.
if (typeof window !== "undefined") {
  onSessionEnded(() => {
    useAuth.getState().setAnonymous();
  });
}
