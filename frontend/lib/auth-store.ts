"use client";

import { create } from "zustand";
import { apiFetch, type User } from "./api";

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
