"use client";

import { create } from "zustand";
import { apiFetch, broadcastSessionEnded, onSessionEnded, type User } from "./api";

type AuthState = {
  user: User | null;
  hydrated: boolean;
  setUser: (user: User) => void;
  logout: () => Promise<void>;
  hydrate: () => Promise<void>;
};

export const useAuth = create<AuthState>((set) => ({
  user: null,
  hydrated: false,
  setUser: (user) => set({ user, hydrated: true }),
  logout: async () => {
    try {
      await apiFetch("/auth/logout", { method: "POST" });
    } finally {
      set({ user: null, hydrated: true });
      broadcastSessionEnded();
    }
  },
  hydrate: async () => {
    try {
      const { user } = await apiFetch<{ user: User }>("/auth/me");
      set({ user, hydrated: true });
    } catch {
      set({ user: null, hydrated: true });
    }
  }
}));

// A logout (or a definitively-rejected refresh) in one tab must sign every other open tab
// out too - cookies are shared, so leaving another tab's cached user in place would just
// let it keep showing a "logged in" UI against a session that no longer exists server-side.
if (typeof window !== "undefined") {
  onSessionEnded(() => {
    useAuth.setState({ user: null, hydrated: true });
  });
}
