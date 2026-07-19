"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore
} from "react";
import { onAuthenticationRefreshed } from "@/lib/api";
import { useAuth } from "@/lib/auth-store";
import {
  RealtimeClient,
  type RealtimeSnapshot
} from "@/lib/realtime-client";

const RealtimeContext = createContext<RealtimeClient | null>(null);

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => new RealtimeClient());
  const userId = useAuth((state) => state.user?.id);
  const hydrated = useAuth((state) => state.hydrated);

  useEffect(() => {
    if (hydrated && userId) client.start();
    else client.stop();
    return () => client.stop();
  }, [client, hydrated, userId]);

  useEffect(() => {
    const syncVisibility = () => client.setVisible(document.visibilityState !== "hidden");
    const handleRefresh = () => client.refreshAuthentication();
    const handleOnline = () => client.setOnline(true);
    const handleOffline = () => client.setOnline(false);

    syncVisibility();
    client.setOnline(navigator.onLine);
    const unsubscribeRefresh = onAuthenticationRefreshed(handleRefresh);
    document.addEventListener("visibilitychange", syncVisibility);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      document.removeEventListener("visibilitychange", syncVisibility);
      unsubscribeRefresh();
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [client]);

  return <RealtimeContext.Provider value={client}>{children}</RealtimeContext.Provider>;
}

export function useRealtime() {
  const client = useContext(RealtimeContext);
  if (!client) throw new Error("useRealtime must be used inside RealtimeProvider");
  return client;
}

export function useRealtimeStatus(): RealtimeSnapshot {
  const client = useRealtime();
  return useSyncExternalStore(client.subscribeState, client.getSnapshot, client.getSnapshot);
}
