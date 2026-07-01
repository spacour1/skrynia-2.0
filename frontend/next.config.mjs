import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    const backendUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
    return [{ source: "/api/:path*", destination: `${backendUrl}/:path*` }];
  }
};

// Skip Sentry webpack plugins entirely when DSN is not configured — avoids adding build
// overhead in local dev and CI environments that don't have a Sentry project set up.
export default process.env.NEXT_PUBLIC_SENTRY_DSN
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      // SENTRY_AUTH_TOKEN is only needed for source map upload; absent = maps skipped.
      authToken: process.env.SENTRY_AUTH_TOKEN,
      silent: true,
      disableLogger: true,
      // Proxy Sentry ingestion through /monitoring to avoid ad-blocker interference.
      tunnelRoute: "/monitoring",
      // Don't expose source maps in the browser — upload to Sentry only.
      hideSourceMaps: true,
    })
  : nextConfig;
