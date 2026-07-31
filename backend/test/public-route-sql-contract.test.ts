import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const modulesRoot = fileURLToPath(new URL("../src/modules/", import.meta.url));
const WILDCARD_SELECT =
  /\b(?:select\s+(?:[a-z_][a-z0-9_]*\s*\.\s*)?\*|returning\s+\*)/gi;

async function routeFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return routeFiles(path);
      return entry.isFile() && entry.name.endsWith(".routes.ts") ? [path] : [];
    })
  );
  return nested.flat();
}

describe("public route SQL contract", () => {
  it("requires explicit select and returning column lists", async () => {
    const violations: string[] = [];

    for (const path of await routeFiles(modulesRoot)) {
      const source = await readFile(path, "utf8");
      for (const match of source.matchAll(WILDCARD_SELECT)) {
        const line =
          source.slice(0, match.index).split(/\r?\n/u).length;
        violations.push(`${basename(path)}:${line}: ${match[0]}`);
      }
    }

    expect(
      violations,
      [
        "Wildcard SQL columns make new database fields public by accident.",
        "List every route-facing column and map internal rows through a DTO."
      ].join(" ")
    ).toEqual([]);
  });
});
