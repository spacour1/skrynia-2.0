"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { usePathname } from "@/lib/navigation";
import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ToastCenter } from "@/components/ToastCenter";
import { LanguageGate } from "@/components/LanguageGate";
import {
  startPendingLogoutRecovery,
  useAuth
} from "@/lib/auth-store";
import { rememberReturnPath } from "@/lib/return-path";
import { PostHogProvider } from "@/components/PostHogProvider";
import { RealtimeProvider } from "@/components/RealtimeProvider";
import { CurrencyProvider } from "@/lib/currency";

export function AuthScopedQueryClientProvider({ children }: { children: ReactNode }) {
  const userId = useAuth((state) => state.user?.id ?? null);
  const status = useAuth((state) => state.status);
  const [client, setClient] = useState(() => new QueryClient());
  const previousIdentity = useRef<string | null | undefined>(undefined);

  useLayoutEffect(() => {
    const previous = previousIdentity.current;
    const hadAccount = previous !== undefined && previous !== null;
    const identityChanged = hadAccount &&
      userId !== null &&
      previous !== userId;
    if (hadAccount && (status === "anonymous" || identityChanged)) {
      // Query observers retain their last result even after QueryClient.clear(). Replace
      // the provider itself before paint so no active screen can render the prior account.
      setClient(new QueryClient());
      client.clear();
    }
    // Remember confirmed identities. A first-load anonymous guest never had an account,
    // so public catalog queries remain untouched.
    if (userId !== null || status !== "unknown") previousIdentity.current = userId;
  }, [client, status, userId]);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

export function Providers({ children }: { children: ReactNode }) {
  const hydrate = useAuth((s) => s.hydrate);
  // usePathname alone (no useSearchParams) so this stays compatible with static rendering;
  // the query string is read straight from window.location inside the effect instead.
  const pathname = usePathname();

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => startPendingLogoutRecovery(), []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    rememberReturnPath(`${pathname}${window.location.search}`);
  }, [pathname]);

  return (
    <AuthScopedQueryClientProvider>
      <PostHogProvider>
        <CurrencyProvider>
          <RealtimeProvider>
            {children}
            <LanguageGate />
            <ToastCenter />
          </RealtimeProvider>
        </CurrencyProvider>
      </PostHogProvider>
    </AuthScopedQueryClientProvider>
  );
}
