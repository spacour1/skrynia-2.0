import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error The runtime config is intentionally authored as native ESM JavaScript.
import nextConfig from "../next.config.mjs";

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
});
