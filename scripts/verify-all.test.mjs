import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { resolve } from "node:path";

import {
  commandInvocation,
  createPlan,
  environmentFor,
  formatCommand,
  formatDuration,
  isolatedPostgresArguments,
  parseArguments,
  repositoryRoot
} from "./verify-all.mjs";

const scriptPath = resolve(repositoryRoot, "scripts/verify-all.mjs");

test("disposable database uses bounded memory storage without weakening PostgreSQL settings", () => {
  const args = isolatedPostgresArguments("keepgame-test-fixture");
  assert.equal(args[args.indexOf("--name") + 1], "keepgame-test-fixture");
  assert.equal(args[args.indexOf("--tmpfs") + 1], "/var/lib/postgresql/data:rw,nosuid,size=1g");
  assert.equal(args[args.indexOf("--publish") + 1], "127.0.0.1::5432");
  assert.ok(args.includes("--rm"));
  assert.equal(args.at(-1), "postgres:16-alpine");
  assert.ok(!args.includes("-c"));
  assert.doesNotMatch(args.join(" "), /fsync=off|synchronous_commit=off|full_page_writes=off|--privileged/);
});

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

test("frontend build and Compose gates use an explicit isolated HTTP policy", () => {
  for (const environment of ["frontend", "compose"]) {
    const values = environmentFor({ environment });
    assert.equal(values.NEXT_PUBLIC_API_URL, "http://127.0.0.1:4000");
    assert.equal(values.NEXT_PUBLIC_SITE_URL, "http://127.0.0.1:3000");
    assert.equal(values.NEXT_PUBLIC_WS_URL, "ws://127.0.0.1:4000/ws");
    assert.equal(values.NEXT_PUBLIC_WS_COOKIE_FALLBACK, "false");
    assert.equal(values.FRONTEND_ALLOW_INSECURE_BUILD, "true");
    assert.equal(values.FRONTEND_CSP_MODE, "enforce");
    assert.equal(values.FRONTEND_HSTS_ENABLED, "false");
    assert.equal(values.NEXT_PUBLIC_MEDIA_ORIGINS, "");
    assert.equal(values.NEXT_PUBLIC_POSTHOG_ASSETS_HOST, "");
    assert.equal(values.NEXT_PUBLIC_POSTHOG_KEY, "");
    assert.equal(values.NEXT_PUBLIC_SENTRY_DSN, "");
    assert.equal(values.SENTRY_AUTH_TOKEN, "");
  }
  assert.equal(environmentFor({ environment: "frontend" }).NODE_ENV, "production");
});

test("local frontend policy cannot inherit an external endpoint or unsafe deployment toggle", (context) => {
  const names = [
    "NEXT_PUBLIC_API_URL", "NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_WS_URL",
    "NEXT_PUBLIC_WS_COOKIE_FALLBACK", "NEXT_PUBLIC_MEDIA_ORIGINS",
    "NEXT_PUBLIC_POSTHOG_ASSETS_HOST", "FRONTEND_ALLOW_INSECURE_BUILD",
    "FRONTEND_CSP_MODE", "FRONTEND_HSTS_ENABLED"
  ];
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  context.after(() => {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  for (const name of names) process.env[name] = "external-sentinel.example.test";

  for (const environment of ["local", "frontend", "compose", "e2e"]) {
    const values = environmentFor({ environment });
    for (const name of names) {
      assert.notEqual(values[name], "external-sentinel.example.test", `${environment}: ${name}`);
    }
    assert.equal(values.FRONTEND_CSP_MODE, "enforce");
    assert.equal(values.FRONTEND_HSTS_ENABLED, "false");
  }
});
