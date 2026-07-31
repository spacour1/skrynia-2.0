import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    setupFiles: ["./test/setup.ts"],
    fileParallelism: false,
    testTimeout: 15_000,
    // resetDb cascades through the integration schema. Keep enough budget for
    // measured Docker-volume fsync while resetDb's lock_timeout catches contention.
    hookTimeout: 30_000
  }
});
