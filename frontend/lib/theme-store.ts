"use client";

import { useEffect } from "react";
import { create } from "zustand";

export type Theme = "light" | "dark";

type ThemeState = {
  theme: Theme;
  hydrated: boolean;
  setTheme: (theme: Theme) => void;
  setThemeAndReload: (theme: Theme) => void;
  toggleTheme: () => void;
  hydrate: () => void;
};

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
}

function commitTheme(theme: Theme) {
  localStorage.setItem("theme", theme);
  applyTheme(theme);
}

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const saved = localStorage.getItem("theme");
  if (saved === "dark" || saved === "light") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: "light",
  hydrated: false,
  setTheme: (theme) => {
    commitTheme(theme);
    set({ theme, hydrated: true });
  },
  setThemeAndReload: (theme) => {
    localStorage.setItem("theme", theme);
    window.location.reload();
  },
  toggleTheme: () => {
    const next = get().theme === "dark" ? "light" : "dark";
    commitTheme(next);
    set({ theme: next, hydrated: true });
  },
  hydrate: () => {
    const theme = getInitialTheme();
    applyTheme(theme);
    set({ theme, hydrated: true });
  }
}));

export function useTheme() {
  const store = useThemeStore();

  useEffect(() => {
    if (!store.hydrated) store.hydrate();
  }, [store.hydrate, store.hydrated]);

  return store;
}
