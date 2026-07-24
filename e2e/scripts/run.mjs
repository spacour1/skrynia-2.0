import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDir, "../..");
const composeFile = resolve(repositoryRoot, "docker-compose.e2e.yml");
const resultsDir = resolve(repositoryRoot, "e2e/test-results");
const reportDir = resolve(repositoryRoot, "e2e/playwright-report");
mkdirSync(resultsDir, { recursive: true });
mkdirSync(reportDir, { recursive: true });

const generatedRunId = `${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${randomBytes(3).toString("hex")}`;
const runId = (process.env.E2E_RUN_ID || generatedRunId)
  .toLowerCase()
  .replace(/[^a-z0-9-]+/g, "-")
  .slice(0, 40);
const projectName = `skrynia-e2e-${runId}`;
const composeArgs = ["compose", "-p", projectName, "-f", composeFile];
const environment = { ...process.env, E2E_RUN_ID: runId };
console.log(`[e2e] run=${runId} project=${projectName}`);

function docker(args, options = {}) {
  return spawnSync("docker", [...composeArgs, ...args], {
    cwd: repositoryRoot,
    env: environment,
    stdio: options.capture ? "pipe" : "inherit",
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024
  });
}

let exitCode = 1;
try {
  console.log("[e2e] building Playwright runner");
  const runnerBuild = docker(["build", "playwright"]);
  if ((runnerBuild.status ?? 1) !== 0) {
    exitCode = runnerBuild.status ?? 1;
  } else {
    console.log("[e2e] starting clean application stack and waiting for health");
    const stack = docker([
      "up",
      "-d",
      "--build",
      "--force-recreate",
      "--wait",
      "--wait-timeout",
      "240",
      "api",
      "worker",
      "outbox",
      "frontend"
    ]);
    if ((stack.status ?? 1) !== 0) {
      exitCode = stack.status ?? 1;
    } else {
      console.log("[e2e] running Chromium specs with workers=1");
      const result = docker([
        "run",
        "--rm",
        "--no-deps",
        "playwright"
      ]);
      exitCode = result.status ?? 1;
    }
  }
  if (exitCode !== 0) {
    console.error(`[e2e] failed with exit code ${exitCode}; collecting stack logs`);
    const logs = docker(
      ["logs", "--no-color", "postgres", "redis", "migrate", "seed", "api", "worker", "outbox", "frontend"],
      { capture: true }
    );
    writeFileSync(
      resolve(resultsDir, `stack-${runId}.log`),
      `${logs.stdout ?? ""}\n${logs.stderr ?? ""}`,
      "utf8"
    );
  }
} finally {
  console.log("[e2e] removing containers, network, and volumes");
  docker(["down", "--volumes", "--remove-orphans", "--timeout", "15"]);
}

process.exit(exitCode);
