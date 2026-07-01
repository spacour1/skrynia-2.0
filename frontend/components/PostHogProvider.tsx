"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { captureEvent, initPostHog, identifyUser, resetPostHogUser } from "../lib/posthog";
import { useAuth } from "../lib/auth-store";

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const user = useAuth((s) => s.user);

  useEffect(() => {
    initPostHog();
  }, []);

  // Identify/reset when auth state changes
  useEffect(() => {
    if (user?.id) {
      identifyUser(user.id);
    } else {
      resetPostHogUser();
    }
  }, [user?.id]);

  // Track page views on route changes
  useEffect(() => {
    captureEvent("page_viewed", { path: pathname });
  }, [pathname]);

  return <>{children}</>;
}
