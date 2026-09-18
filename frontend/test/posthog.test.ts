import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { initMock } = vi.hoisted(() => ({ initMock: vi.fn() }));
vi.mock("posthog-js", () => ({ default: { init: initMock } }));

describe("analytics static-host wiring", () => {
  beforeEach(() => {
    vi.resetModules();
    initMock.mockReset();
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "test-public-key");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_ASSETS_HOST", "");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("preserves the existing EU host and capture settings without an override", async () => {
    const { initPostHog } = await import("@/lib/posthog");
    initPostHog();
    initPostHog();

    expect(initMock).toHaveBeenCalledTimes(1);
    expect(initMock).toHaveBeenCalledWith("test-public-key", {
      api_host: "https://eu.i.posthog.com",
      capture_pageview: false,
      capture_pageleave: true,
      autocapture: false,
      persistence: "localStorage+cookie"
    });
  });

  it("passes the configured static origin to the SDK while retaining its API host", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "https://analytics.example.test");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_ASSETS_HOST", "https://static.example.test");
    const { initPostHog } = await import("@/lib/posthog");
    initPostHog();

    expect(initMock).toHaveBeenCalledWith("test-public-key", expect.objectContaining({
      api_host: "https://analytics.example.test", asset_host: "https://static.example.test"
    }));
  });

  it("does not enable analytics merely because a static host is configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_ASSETS_HOST", "https://static.example.test");
    const { initPostHog } = await import("@/lib/posthog");
    initPostHog();

    expect(initMock).not.toHaveBeenCalled();
  });
});
