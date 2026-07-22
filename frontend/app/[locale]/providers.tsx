"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { usePathname } from "@/lib/navigation";
import { ReactNode, useEffect, useLayoutEffect, useState } from "react";
import { ToastCenter } from "@/components/ToastCenter";
import { LanguageGate } from "@/components/LanguageGate";
import { readCachedUser, useAuth } from "@/lib/auth-store";
import { rememberReturnPath } from "@/lib/return-path";
import { PostHogProvider } from "@/components/PostHogProvider";
import { RealtimeProvider } from "@/components/RealtimeProvider";
import { CurrencyProvider } from "@/lib/currency";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient());
  const hydrate = useAuth((s) => s.hydrate);
  // usePathname alone (no useSearchParams) so this stays compatible with static rendering;
  // the query string is read straight from window.location inside the effect instead.
  const pathname = usePathname();

  // Runs synchronously before the browser paints the hydrated frame, so the cached profile
  // (if any) is already applied by the time anything is visible - this avoids both a flash
  // of "logged out" and a hydration mismatch (the SSR/initial-client render still produced
  // the same `user: null` markup; this just corrects it pre-paint, not pre-hydration).
  useLayoutEffect(() => {
    const cached = readCachedUser();
    if (cached) useAuth.setState({ user: cached });
  }, []);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    rememberReturnPath(`${pathname}${window.location.search}`);
  }, [pathname]);

  return (
    <QueryClientProvider client={client}>
      <PostHogProvider>
        <CurrencyProvider>
          <RealtimeProvider>
            {children}
            <LanguageGate />
            <ToastCenter />
          </RealtimeProvider>
        </CurrencyProvider>
      </PostHogProvider>
    </QueryClientProvider>
  );
}
