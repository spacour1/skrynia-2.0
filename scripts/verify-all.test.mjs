import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { resolve } from "node:path";

import {
  commandInvocation,
  createPlan,
  formatCommand,
  formatDuration,
  parseArguments,
  repositoryRoot
} from "./verify-all.mjs";

const scriptPath = resolve(repositoryRoot, "scripts/verify-all.mjs");

test("default plan faithfully contains every D5 section and the final policy checks", () => {
  const plan = createPlan();
  const ids = plan.map((step) => step.id);

  assert.deepEqual(
    [...new Set(plan.filter((step) => step.section !== "preflight").map((step) => step.section))],
    ["policy", "backend", "frontend", "release"]
  );
  for (const required of [
    "policy.freeze-tests",
    "policy.audit-backend",
    "policy.audit-frontend",
    "policy.audit-e2e",
    "backend.install",
    "backend.lint",
    "backend.typecheck",
    "backend.migrate-1",
    "backend.migrate-2",
    "backend.schema",
    "backend.tests",
    "frontend.install",
    "frontend.lint",
    "frontend.typecheck",
    "frontend.i18n",
    "frontend.tests",
    "frontend.build",
    "release.compose-production",
    "release.compose-development",
    "release.compose-e2e",
    "release.images",
    "release.e2e",
    "release.gitleaks",
    "release.final-diff",
    "release.final-freeze"
  ]) {
    assert.ok(ids.includes(required), `missing ${required}`);
  }
  assert.ok(ids.indexOf("backend.migrate-1") < ids.indexOf("backend.migrate-2"));
  assert.ok(ids.indexOf("release.gitleaks") < ids.indexOf("release.final-freeze"));
});

test("argument parsing supports scoped milestone checks and rejects unsafe ambiguity", () => {
  assert.deepEqual(parseArguments(["--only", "policy,frontend", "--base", "HEAD~1"]), {
    base: "HEAD~1",
    dryRun: false,
    help: false,
    list: false,
    sections: ["policy", "frontend"]
  });
  assert.throws(() => parseArguments(["--only", "provider"]), /--only accepts/);
  assert.throws(() => parseArguments(["--list", "--dry-run"]), /either --list or --dry-run/);
  assert.throws(() => parseArguments(["--base"]), /requires a Git ref/);
});

test("list mode is side-effect free and reports NOT RUN", () => {
  const sentinel = "must-never-appear-in-output";
  const run = spawnSync(process.execPath, [scriptPath, "--list", "--only", "backend"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, LIQPAY_PRIVATE_KEY: sentinel }
  });

  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /\[NOT RUN\] backend\.services/);
  assert.doesNotMatch(run.stdout, new RegExp(sentinel));
  assert.doesNotMatch(run.stdout, /\[RUN\]/);
});

test("dry-run mode does not require provider credentials or start tools", () => {
  const run = spawnSync(process.execPath, [scriptPath, "--dry-run", "--only", "release"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { PATH: process.env.PATH }
  });

  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /no commands, containers, downloads, or provider calls/i);
  assert.match(run.stdout, /\[NOT RUN\] release\.gitleaks/);
});

test("formatters produce stable command and duration evidence", () => {
  assert.equal(formatCommand("docker", ["compose", "--profile", "*", "config", "--quiet"]), 'docker compose --profile "*" config --quiet');
  assert.equal(formatDuration(999), "999ms");
  assert.equal(formatDuration(1_250), "1.3s");
});

test("Windows npm and npx run through the pinned Node distribution without cmd.exe", () => {
  assert.deepEqual(
    commandInvocation("npm", ["ci"], "win32", "C:\\tools\\node\\node.exe"),
    {
      args: ["C:\\tools\\node\\node_modules\\npm\\bin\\npm-cli.js", "ci"],
      command: "C:\\tools\\node\\node.exe"
    }
  );
  assert.deepEqual(
    commandInvocation("npx", ["vitest", "run"], "win32", "C:\\tools\\node\\node.exe"),
    {
      args: ["C:\\tools\\node\\node_modules\\npm\\bin\\npx-cli.js", "vitest", "run"],
      command: "C:\\tools\\node\\node.exe"
    }
  );
  assert.deepEqual(
    commandInvocation("git", ["diff", "--check"], "win32", "C:\\tools\\node\\node.exe"),
    { args: ["diff", "--check"], command: "git" }
  );
});
