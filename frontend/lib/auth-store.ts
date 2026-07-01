"use client";

import { create } from "zustand";
import * as Sentry from "@sentry/nextjs";
import { apiFetch, broadcastSessionEnded, onSessionEnded, type User } from "./api";

type AuthState = {
  user: User | null;
  hydrated: boolean;
  setUser: (user: User) => void;
  logout: () => Promise<void>;
  hydrate: () => Promise<void>;
};

// Holds only non-sensitive profile fields (no tokens - those stay in httpOnly cookies) so
// the nav bar can render the logged-in UI immediately on page load instead of flashing
// "logged out" for the round trip hydrate() needs to confirm the session via /auth/me.
const CACHED_USER_KEY = "auth_cached_user";

export function readCachedUser(): User | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHED_USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

function writeCachedUser(user: User | null) {
  if (typeof window === "undefined") return;
  if (user) window.localStorage.setItem(CACHED_USER_KEY, JSON.stringify(user));
  else window.localStorage.removeItem(CACHED_USER_KEY);
}

export const useAuth = create<AuthState>((set) => ({
  // Starts null (not readCachedUser()) so this matches Next's server-rendered markup -
  // the cache is applied client-side from a layout effect in Providers instead, which runs
  // before paint and so avoids both a hydration mismatch and a visible logged-out flash.
  user: null,
  hydrated: false,
  setUser: (user) => {
    writeCachedUser(user);
    Sentry.setUser({ id: user.id, segment: user.role });
    set({ user, hydrated: true });
  },
  logout: async () => {
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } finally {
      writeCachedUser(null);
      Sentry.setUser(null);
      set({ user: null, hydrated: true });
      broadcastSessionEnded();
    }
  },
  hydrate: async () => {
    try {
      const { user } = await apiFetch<{ user: User }>("/auth/me");
      writeCachedUser(user);
      Sentry.setUser({ id: user.id, segment: user.role });
      set({ user, hydrated: true });
    } catch {
      writeCachedUser(null);
      Sentry.setUser(null);
      set({ user: null, hydrated: true });
    }
  }
}));

// A logout (or a definitively-rejected refresh) in one tab must sign every other open tab
// out too - cookies are shared, so leaving another tab's cached user in place would just
// let it keep showing a "logged in" UI against a session that no longer exists server-side.
if (typeof window !== "undefined") {
  onSessionEnded(() => {
    writeCachedUser(null);
    useAuth.setState({ user: null, hydrated: true });
  });
}
