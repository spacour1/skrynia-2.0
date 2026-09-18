// Build-time policy only. Never copy private provider credentials into Next's env.
function fail(name) {
  throw new Error(`Invalid frontend environment: ${name}`);
}

function boolean(environment, name, fallback = false) {
  const value = environment[name];
  if (value === undefined || value === "") return fallback;
  if (value !== "true" && value !== "false") fail(name);
  return value === "true";
}

function url(environment, name, { fallback, protocols, originOnly = true, dsn = false }) {
  const raw = environment[name] || fallback;
  if (!raw || /[\s*]/u.test(raw)) fail(name);
  let parsed;
  try { parsed = new URL(raw); } catch { fail(name); }
  if (!protocols.includes(parsed.protocol) || parsed.password || (!dsn && parsed.username) ||
      parsed.search || parsed.hash || (originOnly && parsed.pathname !== "/")) fail(name);
  return originOnly ? parsed.origin : parsed.href;
}

export function frontendSecurityEnvironment(environment = process.env) {
  const production = environment.NODE_ENV === "production";
  const insecure = boolean(environment, "FRONTEND_ALLOW_INSECURE_BUILD");
  const secureProtocols = production && !insecure ? ["https:"] : ["http:", "https:"];
  const apiUrl = url(environment, "NEXT_PUBLIC_API_URL", {
    fallback: production ? undefined : "http://localhost:4000", protocols: ["http:", "https:"]
  });
  const siteUrl = url(environment, "NEXT_PUBLIC_SITE_URL", {
    fallback: production ? undefined : "http://localhost:3000", protocols: secureProtocols
  });
  const wsUrl = url(environment, "NEXT_PUBLIC_WS_URL", {
    fallback: production ? undefined : "ws://localhost:4000/ws",
    protocols: siteUrl.startsWith("https:") ? ["wss:"] : ["ws:", "wss:"], originOnly: false
  });
  boolean(environment, "NEXT_PUBLIC_WS_COOKIE_FALLBACK");
  const hsts = boolean(environment, "FRONTEND_HSTS_ENABLED");
  if (hsts && (!production || !siteUrl.startsWith("https:") || insecure)) fail("FRONTEND_HSTS_ENABLED");
  const mode = environment.FRONTEND_CSP_MODE || "report-only";
  if (mode !== "report-only" && mode !== "enforce") fail("FRONTEND_CSP_MODE");
  const mediaOrigins = [...new Set((environment.NEXT_PUBLIC_MEDIA_ORIGINS || "")
    .split(",").filter((item) => item.trim()).map((item) => url(
      { NEXT_PUBLIC_MEDIA_ORIGINS: item.trim() }, "NEXT_PUBLIC_MEDIA_ORIGINS", { protocols: secureProtocols }
    )))];
  if (mediaOrigins.length > 20) fail("NEXT_PUBLIC_MEDIA_ORIGINS");
  if (environment.NEXT_PUBLIC_SENTRY_DSN) url(environment, "NEXT_PUBLIC_SENTRY_DSN", {
    protocols: secureProtocols, originOnly: false, dsn: true
  });
  let posthogOrigin;
  let posthogFlagsOrigin;
  let posthogRemoteConfigOrigin;
  let posthogAssetsOrigin;
  // Validate optional hosts even when analytics is disabled; emit no egress allowance
  // unless a project key explicitly enables the existing analytics integration.
  const configuredPosthog = environment.NEXT_PUBLIC_POSTHOG_HOST ? url(environment, "NEXT_PUBLIC_POSTHOG_HOST", {
    protocols: secureProtocols
  }) : "https://eu.i.posthog.com";
  const configuredAssets = environment.NEXT_PUBLIC_POSTHOG_ASSETS_HOST ? url(environment, "NEXT_PUBLIC_POSTHOG_ASSETS_HOST", {
    protocols: secureProtocols
  }) : undefined;
  if (environment.NEXT_PUBLIC_POSTHOG_KEY) {
    // Match the installed SDK's RequestRouter, including its legacy cloud aliases.
    // Events, flags and remote config do not all use the same host. asset_host
    // overrides /static/* only; /array/* still uses the region's assets origin.
    const sdkHost = (environment.NEXT_PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com").replace(/\/$/, "");
    const region = /https:\/\/(app|us|us-assets)(\.i)?\.posthog\.com/i.test(sdkHost) ? "us"
      : /https:\/\/(eu|eu-assets)(\.i)?\.posthog\.com/i.test(sdkHost) ? "eu" : undefined;
    posthogOrigin = region ? `https://${region}.i.posthog.com` : configuredPosthog;
    posthogFlagsOrigin = sdkHost === "https://app.posthog.com"
      ? "https://us.i.posthog.com" : configuredPosthog;
    posthogRemoteConfigOrigin = region ? `https://${region}-assets.i.posthog.com` : configuredPosthog;
    posthogAssetsOrigin = configuredAssets || posthogRemoteConfigOrigin;
  }
  return {
    production, apiUrl, siteUrl, wsUrl, hsts, mode, mediaOrigins,
    posthogOrigin, posthogFlagsOrigin, posthogRemoteConfigOrigin, posthogAssetsOrigin
  };
}

export function frontendSecurityHeaders(environment = process.env) {
  const policy = frontendSecurityEnvironment(environment);
  const csp = Object.entries({
    "default-src": ["'self'"],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
    "frame-ancestors": ["'none'"],
    "frame-src": ["'none'"],
    // App Router hydration and statically generated routes need inline scripts.
    // A nonce policy requires a separate dynamic-rendering migration, not a fixed nonce.
    "script-src": [
      "'self'", "'unsafe-inline'", ...(!policy.production ? ["'unsafe-eval'"] : []),
      policy.posthogAssetsOrigin, policy.posthogRemoteConfigOrigin
    ],
    "script-src-attr": ["'none'"],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", ...policy.mediaOrigins],
    "font-src": ["'self'", "data:"],
    "connect-src": [
      "'self'", new URL(policy.wsUrl).origin, policy.posthogOrigin,
      policy.posthogFlagsOrigin, policy.posthogRemoteConfigOrigin, policy.posthogAssetsOrigin
    ],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"]
  }).map(([directive, sources]) => `${directive} ${[...new Set(sources.filter(Boolean))].join(" ")}`).join("; ");
  return [
    { key: policy.mode === "enforce" ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only", value: csp },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    ...(policy.hsts ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }] : [])
  ];
}
