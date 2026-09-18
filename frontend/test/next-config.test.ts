import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error The runtime config is intentionally authored as native ESM JavaScript.
import nextConfig, { createNextConfig, createSentryBuildOptions } from "../next.config.mjs";

type RewriteConfig = {
  rewrites(): Promise<Array<{ source: string; destination: string }>>;
  output?: string;
};

const config = nextConfig as RewriteConfig;
const originalBackendUrl = process.env.NEXT_PUBLIC_API_URL;

afterEach(() => {
  if (originalBackendUrl === undefined) delete process.env.NEXT_PUBLIC_API_URL;
  else process.env.NEXT_PUBLIC_API_URL = originalBackendUrl;
});

describe("Next runtime config", () => {
  it("fails loading an incomplete production config and generates headers for every route", async () => {
    expect(() => createNextConfig({ NODE_ENV: "production" })).toThrow("NEXT_PUBLIC_API_URL");
    const secure = createNextConfig({
      NODE_ENV: "production", NEXT_PUBLIC_API_URL: "http://backend:4000",
      NEXT_PUBLIC_SITE_URL: "https://app.example.test", NEXT_PUBLIC_WS_URL: "wss://api.example.test/ws"
    });
    expect(secure.poweredByHeader).toBe(false);
    await expect(secure.headers()).resolves.toEqual([{
      source: "/:path*",
      headers: expect.arrayContaining([
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Content-Security-Policy-Report-Only", value: expect.stringContaining("frame-ancestors 'none'") }
      ])
    }]);
  });
  it("keeps standalone output and a deployment-fixed API rewrite host", async () => {
    process.env.NEXT_PUBLIC_API_URL = "https://backend.internal.example:4443";

    expect(config.output).toBe("standalone");
    await expect(config.rewrites()).resolves.toEqual([
      {
        source: "/api/:path*",
        destination: "https://backend.internal.example:4443/:path*"
      }
    ]);
  });

  it("generates source maps only for an authenticated upload and removes them afterward", () => {
    expect(createSentryBuildOptions({})).toMatchObject({
      sourcemaps: { disable: true },
      webpack: { treeshake: { removeDebugLogging: true } },
    });
    expect(
      createSentryBuildOptions({
        SENTRY_AUTH_TOKEN: "test-auth-token",
        SENTRY_ORG: "test-org",
        SENTRY_PROJECT: "test-project",
      })
    ).toMatchObject({
      sourcemaps: { deleteSourcemapsAfterUpload: true },
      webpack: { treeshake: { removeDebugLogging: true } },
    });
    expect(createSentryBuildOptions({})).not.toHaveProperty("hideSourceMaps");
  });
});
