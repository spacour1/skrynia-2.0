import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  async rewrites() {
    const backendUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
    return [{ source: "/api/:path*", destination: `${backendUrl}/:path*` }];
  }
};

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
