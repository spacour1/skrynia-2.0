import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const backendRoot = path.resolve(import.meta.dirname, "..");

describe("runtime entrypoint contracts", () => {
  it("keeps the API entrypoint free of background processor startup", () => {
    const source = fs.readFileSync(
      path.join(backendRoot, "src", "entrypoints", "api.ts"),
      "utf8"
    );
    expect(source).not.toContain("startJobWorker");
    expect(source).not.toContain("startOutboxWorker");
  });

  it("exposes independent production commands", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(backendRoot, "package.json"), "utf8")
    ) as { scripts: Record<string, string> };
    expect(manifest.scripts["start:api"]).toBe("node dist/entrypoints/api.js");
    expect(manifest.scripts["start:worker"]).toBe(
      "node dist/entrypoints/worker.js"
    );
    expect(manifest.scripts["start:outbox"]).toBe(
      "node dist/entrypoints/outbox.js"
    );
  });

  it("keeps release migrations out of every long-running start command", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(backendRoot, "package.json"), "utf8")
    ) as { scripts: Record<string, string> };

    expect(manifest.scripts["migrate:deploy"]).toBe(
      "node dist/db/migrate-deploy.cli.js"
    );
    for (const name of ["start:api", "start:worker", "start:outbox"]) {
      expect(manifest.scripts[name]).not.toMatch(/migrat/i);
    }
  });

  it.each([
    ["api.ts", "await startRealtimeServices()"],
    ["worker.ts", "await startJobWorker()"],
    ["outbox.ts", "await startOutboxWorker()"]
  ] as const)(
    "installs lifecycle ownership before %s performs external startup",
    (entrypoint, externalStartup) => {
      const source = fs.readFileSync(
        path.join(backendRoot, "src", "entrypoints", entrypoint),
        "utf8"
      );
      const lifecycleInstall = source.indexOf(
        "const lifecycle = installProcessLifecycle("
      );
      const startup = source.indexOf(externalStartup);

      expect(lifecycleInstall).toBeGreaterThan(-1);
      expect(startup).toBeGreaterThan(-1);
      expect(lifecycleInstall).toBeLessThan(startup);
    }
  );
});
