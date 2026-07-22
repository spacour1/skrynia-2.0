"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
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
  const mountedRef = useRef(true);
  const revalidationInFlightRef = useRef(false);
  const [client] = useState(() => {
    let instance: RealtimeClient;
    instance = new RealtimeClient({
      onTerminalAuthenticationFailure: () => {
        if (revalidationInFlightRef.current) return;
        revalidationInFlightRef.current = true;
        void useAuth.getState().hydrate()
          .then((nextStatus) => {
            if (
              mountedRef.current &&
              nextStatus === "authenticated" &&
              useAuth.getState().user &&
              instance.getSnapshot().status === "stopped"
            ) {
              instance.refreshAuthentication();
            }
          })
          .finally(() => {
            revalidationInFlightRef.current = false;
          });
      }
    });
    return instance;
  });
  const userId = useAuth((state) => state.user?.id);
  const status = useAuth((state) => state.status);
  const activeUserIdRef = useRef<string | null>(null);
  const previousStatusRef = useRef(status);

  useEffect(() => {
    const previousStatus = previousStatusRef.current;
    previousStatusRef.current = status;

    if (userId && (status === "authenticated" || status === "degraded")) {
      const switchedUser = Boolean(activeUserIdRef.current && activeUserIdRef.current !== userId);
      const recoveredTerminalConnection =
        status === "authenticated" &&
        previousStatus === "degraded" &&
        client.getSnapshot().status === "stopped";
      activeUserIdRef.current = userId;
      if (switchedUser || recoveredTerminalConnection) client.refreshAuthentication();
      else client.start();
      return;
    }

    if (status === "anonymous" || !userId) {
      activeUserIdRef.current = null;
      client.stop();
    }
  }, [client, status, userId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      client.stop();
    };
  }, [client]);

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
