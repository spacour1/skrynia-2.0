import { withSentryConfig } from "@sentry/nextjs";
import { frontendSecurityEnvironment, frontendSecurityHeaders } from "./config/security.mjs";

export function createNextConfig(environment = process.env) {
  // Validate while loading the production config, before building or accepting traffic.
  frontendSecurityEnvironment(environment);
  /** @type {import('next').NextConfig} */
  const config = {
    reactStrictMode: true,
    poweredByHeader: false,
    output: "standalone",
    async rewrites() {
      const { apiUrl } = frontendSecurityEnvironment(environment);
      return [{ source: "/api/:path*", destination: `${apiUrl}/:path*` }];
    },
    async headers() {
      return [{ source: "/:path*", headers: frontendSecurityHeaders(environment) }];
    }
  };
  return config;
}

const nextConfig = createNextConfig();

export function createSentryBuildOptions(environment = process.env) {
  const canUploadSourceMaps = Boolean(
    environment.SENTRY_AUTH_TOKEN && environment.SENTRY_ORG && environment.SENTRY_PROJECT
  );

  return {
    org: environment.SENTRY_ORG,
    project: environment.SENTRY_PROJECT,
    authToken: environment.SENTRY_AUTH_TOKEN,
    silent: true,
    tunnelRoute: "/monitoring",
    webpack: {
      treeshake: {
        removeDebugLogging: true,
      },
    },
    // Sentry v9 removed hideSourceMaps. Generate maps only when the build can
    // upload them, then delete the browser maps after the upload completes.
    sourcemaps: canUploadSourceMaps
      ? { deleteSourcemapsAfterUpload: true }
      : { disable: true },
  };
}

// Skip Sentry webpack plugins entirely when DSN is not configured — avoids adding build
// overhead in local dev and CI environments that don't have a Sentry project set up.
export default process.env.NEXT_PUBLIC_SENTRY_DSN
  ? withSentryConfig(nextConfig, createSentryBuildOptions())
  : nextConfig;
