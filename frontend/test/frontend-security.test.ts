import { describe, expect, it } from "vitest";
import { RequestRouter } from "posthog-js/lib/src/utils/request-router.js";
// @ts-expect-error Native ESM is also consumed by the build without TypeScript.
import { frontendSecurityEnvironment, frontendSecurityHeaders } from "../config/security.mjs";

const production = {
  NODE_ENV: "production",
  NEXT_PUBLIC_API_URL: "http://backend:4000",
  NEXT_PUBLIC_SITE_URL: "https://keepgame.example",
  NEXT_PUBLIC_WS_URL: "wss://api.keepgame.example/ws"
};

function headers(environment = production): Record<string, string> {
  return Object.fromEntries(frontendSecurityHeaders(environment).map(
    ({ key, value }: { key: string; value: string }) => [key, value]
  ));
}

describe("frontend environment and browser security policy", () => {
  it.each(["NEXT_PUBLIC_API_URL", "NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_WS_URL"])(
    "requires %s in production", (name) => {
      expect(() => frontendSecurityEnvironment({ ...production, [name]: "" })).toThrow(name);
    }
  );

  it.each([
    ["NEXT_PUBLIC_API_URL", "https://user:private@example.test"],
    ["NEXT_PUBLIC_API_URL", "file:///etc/passwd"],
    ["NEXT_PUBLIC_SITE_URL", "https://example.test/subpath"],
    ["NEXT_PUBLIC_SITE_URL", "http://example.test"],
    ["NEXT_PUBLIC_WS_URL", "ws://example.test/ws"],
    ["NEXT_PUBLIC_WS_URL", "wss://example.test/ws?ticket=private"],
    ["NEXT_PUBLIC_WS_ORIGINS", "ws://replica.example.test"],
    ["NEXT_PUBLIC_WS_ORIGINS", "wss://*.example.test"],
    ["NEXT_PUBLIC_WS_ORIGINS", "wss://replica.example.test/ws"],
    ["NEXT_PUBLIC_WS_ORIGINS", "https://replica.example.test"],
    ["NEXT_PUBLIC_MEDIA_ORIGINS", "https://*.example.test"],
    ["NEXT_PUBLIC_MEDIA_ORIGINS", "https://example.test; script-src *"],
    ["NEXT_PUBLIC_POSTHOG_HOST", "https://example.test/#private"],
    ["NEXT_PUBLIC_SENTRY_DSN", "javascript:private"],
    ["FRONTEND_ALLOW_INSECURE_BUILD", "1"],
    ["FRONTEND_HSTS_ENABLED", "yes"],
    ["NEXT_PUBLIC_WS_COOKIE_FALLBACK", "on"],
    ["FRONTEND_CSP_MODE", "disabled"]
  ])("rejects invalid %s without echoing supplied values", (name, value) => {
    expect(() => frontendSecurityEnvironment({ ...production, [name]: value }))
      .toThrow(`Invalid frontend environment: ${name}`);
    try { frontendSecurityEnvironment({ ...production, [name]: value }); } catch (error) {
      expect((error as Error).message).toBe(`Invalid frontend environment: ${name}`);
    }
  });

  it("allows explicit HTTP isolated test builds without enabling HSTS", () => {
    const env = {
      ...production, FRONTEND_ALLOW_INSECURE_BUILD: "true",
      NEXT_PUBLIC_SITE_URL: "http://frontend:3000", NEXT_PUBLIC_WS_URL: "ws://api:4000/ws"
    };
    expect(frontendSecurityEnvironment(env).siteUrl).toBe("http://frontend:3000");
    expect(headers(env)).not.toHaveProperty("Strict-Transport-Security");
    expect(() => frontendSecurityEnvironment({ ...env, FRONTEND_HSTS_ENABLED: "true" })).toThrow("FRONTEND_HSTS_ENABLED");
  });

  it("provides development defaults without a production localhost fallback", () => {
    expect(frontendSecurityEnvironment({ NODE_ENV: "development" })).toMatchObject({
      apiUrl: "http://localhost:4000", siteUrl: "http://localhost:3000", wsUrl: "ws://localhost:4000/ws"
    });
  });

  it("permits only explicitly configured replica socket origins and bounds their count", () => {
    const extra = "wss://replica.example.test:8443";
    const csp = headers({ ...production, ...{ NEXT_PUBLIC_WS_ORIGINS: `${extra}, ${extra}/` } })
      ["Content-Security-Policy-Report-Only"];
    expect(csp).toContain(`connect-src 'self' wss://api.keepgame.example ${extra};`);
    expect(csp).not.toContain("img-src 'self' data: blob: wss:");
    expect(headers()["Content-Security-Policy-Report-Only"]).not.toContain(extra);
    expect(() => frontendSecurityEnvironment({
      ...production,
      NEXT_PUBLIC_WS_ORIGINS: Array.from({ length: 21 }, (_, index) => `wss://replica${index}.example.test`).join(",")
    })).toThrow("NEXT_PUBLIC_WS_ORIGINS");
    const isolated = {
      NODE_ENV: "production", FRONTEND_ALLOW_INSECURE_BUILD: "true",
      NEXT_PUBLIC_API_URL: "http://api:4000", NEXT_PUBLIC_SITE_URL: "http://frontend:3000",
      NEXT_PUBLIC_WS_URL: "ws://api:4000/ws", NEXT_PUBLIC_WS_ORIGINS: "ws://api-replica:4000"
    };
    expect(headers(isolated)["Content-Security-Policy-Report-Only"])
      .toContain("connect-src 'self' ws://api:4000 ws://api-replica:4000;");
  });

  it("defaults to report-only with bounded egress and frame protection", () => {
    const result = headers();
    expect(result).not.toHaveProperty("Content-Security-Policy");
    expect(result).not.toHaveProperty("Strict-Transport-Security");
    expect(result).toMatchObject({
      "X-Frame-Options": "DENY", "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin"
    });
    const csp = result["Content-Security-Policy-Report-Only"];
    expect(csp).toContain("connect-src 'self' wss://api.keepgame.example");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("script-src-attr 'none'");
    expect(csp).not.toMatch(/unsafe-eval|https:;|\*/);
    expect(csp).not.toContain("posthog.com");
    expect(csp).not.toContain("backend:4000");
  });

  it("enforces only when explicitly selected and uses no preload or subdomain HSTS", () => {
    const result = headers({ ...production, ...{ FRONTEND_CSP_MODE: "enforce", FRONTEND_HSTS_ENABLED: "true" } });
    expect(result).toHaveProperty("Content-Security-Policy");
    expect(result).not.toHaveProperty("Content-Security-Policy-Report-Only");
    expect(result["Strict-Transport-Security"]).toBe("max-age=31536000");
  });

  it("preserves existing hosted navigation without introducing form or navigation restrictions", () => {
    const csp = headers()["Content-Security-Policy-Report-Only"];
    expect(csp).not.toContain("form-action");
    expect(csp).not.toContain("navigate-to");
  });

  it("allows only selected media and the enabled analytics region, retaining same-origin Sentry", () => {
    const result = headers({ ...production, ...{
      NEXT_PUBLIC_MEDIA_ORIGINS: "https://media.example:8443/, https://media.example:8443",
      NEXT_PUBLIC_POSTHOG_KEY: "test-public-key",
      NEXT_PUBLIC_SENTRY_DSN: "https://public-key@o123.ingest.sentry.io/123"
    } });
    const csp = result["Content-Security-Policy-Report-Only"];
    expect(csp).toContain("img-src 'self' data: blob: https://media.example:8443;");
    expect(csp).toContain("https://eu.i.posthog.com https://eu-assets.i.posthog.com");
    expect(csp).not.toContain("us.i.posthog.com");
    expect(csp).not.toContain("ingest.sentry.io");
    expect(csp).not.toContain("public-key");
  });

  it.each([
    ["https://eu.i.posthog.com", undefined],
    ["https://us.i.posthog.com", undefined],
    ["https://app.posthog.com", undefined],
    ["https://app.posthog.com/", undefined],
    ["https://APP.posthog.com", undefined],
    ["https://eu.posthog.com", undefined],
    ["https://us.posthog.com", undefined],
    ["https://analytics.example.test", undefined],
    ["https://eu.i.posthog.com", "https://static.example.test"],
    ["https://analytics.example.test", "https://static.example.test"]
  ])("matches installed PostHog routes for host %s and static override %s", (host, assets) => {
    const environment = {
      ...production,
      NEXT_PUBLIC_POSTHOG_KEY: "test-public-key",
      NEXT_PUBLIC_POSTHOG_HOST: host,
      ...(assets ? { NEXT_PUBLIC_POSTHOG_ASSETS_HOST: assets } : {})
    };
    // RequestRouter only reads config: constructing this minimal instance never
    // initializes the SDK, captures an event or contacts a provider.
    const router = new RequestRouter({ config: {
      api_host: host, ...(assets ? { asset_host: assets } : {})
    } } as ConstructorParameters<typeof RequestRouter>[0]);
    const directives = Object.fromEntries(headers(environment)["Content-Security-Policy-Report-Only"]
      .split("; ").map((part) => {
        const [name, ...sources] = part.split(" ");
        return [name, sources];
      }));

    for (const [target, path] of [
      ["api", "/e/"], ["flags", "/flags/"], ["assets", "/array/test/config"],
      ["assets", "/static/recorder.js"]
    ] as const) {
      expect(directives["connect-src"]).toContain(new URL(router.endpointFor(target, path)).origin);
    }
    const staticOrigin = new URL(router.endpointFor("assets", "/static/recorder.js")).origin;
    // The SDK loads JS remote config before its JSON fallback. A static-host
    // override does not move /array/*, so that exact script origin remains needed.
    const remoteConfigOrigin = new URL(router.endpointFor("assets", "/array/test/config.js")).origin;
    expect(directives["script-src"].filter((source: string) => source.startsWith("https://")))
      .toEqual([...new Set([staticOrigin, remoteConfigOrigin])]);
  });
});
