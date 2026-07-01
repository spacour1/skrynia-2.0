import posthog from "posthog-js";

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com";

let initialized = false;

export function initPostHog() {
  if (typeof window === "undefined" || !POSTHOG_KEY || initialized) return;
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    capture_pageview: false,  // manual via PostHogProvider
    capture_pageleave: true,
    autocapture: false,       // explicit events only — no click/form capture
    persistence: "localStorage+cookie",
  });
  initialized = true;
}

// Safe event capture. NEVER pass: passwords, tokens, payment credentials,
// bank details, message bodies, personal documents, or private user data.
export function captureEvent(event: string, properties?: Record<string, unknown>) {
  if (typeof window === "undefined" || !POSTHOG_KEY) return;
  posthog.capture(event, properties);
}

export function identifyUser(userId: string) {
  if (typeof window === "undefined" || !POSTHOG_KEY) return;
  posthog.identify(userId);
}

export function resetPostHogUser() {
  if (typeof window === "undefined" || !POSTHOG_KEY) return;
  posthog.reset();
}
