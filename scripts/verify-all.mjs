#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, win32 as win32Path } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = resolve(scriptDirectory, "..");

const REQUIRED_NODE_VERSION = "20.20.2";
const REQUIRED_NPM_VERSION = "10.8.2";
const GITLEAKS_VERSION = "8.30.1";
const GITLEAKS_RELEASE_BASE = `https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}`;
const GITLEAKS_ASSETS = Object.freeze({
  "linux-x64": {
    archive: `gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz`,
    checksum: "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb",
    executable: "gitleaks"
  },
  "win32-x64": {
    archive: `gitleaks_${GITLEAKS_VERSION}_windows_x64.zip`,
    checksum: "d29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e",
    executable: "gitleaks.exe"
  }
});

const ALL_SECTIONS = Object.freeze(["policy", "backend", "frontend", "release"]);
const ALLOWED_STATUSES = new Set(["PASS", "FAIL", "BLOCKED", "NOT RUN"]);

const providerEnvironment = Object.freeze({
  AWS_ACCESS_KEY_ID: "",
  AWS_SECRET_ACCESS_KEY: "",
  AWS_SESSION_TOKEN: "",
  LIQPAY_PRIVATE_KEY: "",
  LIQPAY_PUBLIC_KEY: "",
  LIQPAY_SERVER_URL: "",
  MANUAL_PAYMENT_BANK: "",
  MANUAL_PAYMENT_CARD_NUMBER: "",
  MANUAL_PAYMENT_RECEIVER_NAME: "",
  MONOBANK_TOKEN: "",
  MONOBANK_WEBHOOK_URL: "",
  NEXT_PUBLIC_POSTHOG_HOST: "",
  NEXT_PUBLIC_POSTHOG_ASSETS_HOST: "",
  NEXT_PUBLIC_POSTHOG_KEY: "",
  NEXT_PUBLIC_SENTRY_DSN: "",
  POSTHOG_API_KEY: "",
  RESEND_API_KEY: "",
  S3_ACCESS_KEY_ID: "",
  S3_SECRET_ACCESS_KEY: "",
  SENTRY_AUTH_TOKEN: "",
  SENTRY_DSN: "",
  SENTRY_ORG: "",
  SENTRY_PROJECT: "",
  SMTP_PASSWORD: "",
  SMTP_USER: "",
  TELEGRAM_BOT_TOKEN: "",
  TELEGRAM_WEBHOOK_SECRET: "",
  TWILIO_ACCOUNT_SID: "",
  TWILIO_AUTH_TOKEN: "",
  TWILIO_VERIFY_SERVICE_SID: "",
  WAYFORPAY_MERCHANT_ACCOUNT: "",
  WAYFORPAY_MERCHANT_SECRET_KEY: "",
  WAYFORPAY_SERVICE_URL: ""
});

const localFrontendEnvironment = Object.freeze({
  FRONTEND_ALLOW_INSECURE_BUILD: "true",
  FRONTEND_CSP_MODE: "enforce",
  FRONTEND_HSTS_ENABLED: "false",
  NEXT_PUBLIC_API_URL: "http://127.0.0.1:4000",
  NEXT_PUBLIC_MEDIA_ORIGINS: "",
  NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3000",
  NEXT_PUBLIC_WS_COOKIE_FALLBACK: "false",
  NEXT_PUBLIC_WS_URL: "ws://127.0.0.1:4000/ws"
});

const localOnlyEnvironment = Object.freeze({
  ...providerEnvironment,
  ...localFrontendEnvironment,
  ENABLE_TEST_PAYMENTS: "false",
  NODE_ENV: "test"
});

const productionComposeEnvironment = Object.freeze({
  ...providerEnvironment,
  ...localFrontendEnvironment,
  FRONTEND_URL: "http://127.0.0.1:3000",
  PUBLIC_BACKEND_URL: "http://127.0.0.1:4000",
  JWT_SECRET: "verify-only-jwt-secret-aaaaaaaaaaaa",
  METRICS_PASSWORD: "verify-only-metrics-password",
  POSTGRES_DB: "marketplace_verify",
  POSTGRES_PASSWORD: "verify-only-postgres-password",
  POSTGRES_USER: "marketplace_verify",
  SKRYNIA_IMAGE_TAG: "verify",
  TWO_FACTOR_ENCRYPTION_KEY: "1111111111111111111111111111111111111111111111111111111111111111"
});

export function commandInvocation(
  command,
  args = [],
  platform = process.platform,
  execPath = process.execPath
) {
  if (platform === "win32" && (command === "npm" || command === "npx")) {
    const cliPath = win32Path.join(
      win32Path.dirname(execPath),
      "node_modules",
      "npm",
      "bin",
      `${command}-cli.js`
    );
    return { args: [cliPath, ...args], command: execPath };
  }
  return { args, command };
}

function displayArgument(value) {
  if (/^[A-Za-z0-9_./:@='-]+$/.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}

export function formatCommand(command, args = []) {
  return [command, ...args].map(displayArgument).join(" ");
}

function commandStep(id, section, label, command, args, options = {}) {
  return {
    id,
    section,
    label,
    command,
    args,
    cwd: options.cwd ?? repositoryRoot,
    environment: options.environment ?? "local",
    display: options.display ?? formatCommand(command, args),
    type: "command"
  };
}

function internalStep(id, section, label, display, type) {
  return { id, section, label, display, type };
}

export function createPlan({ base = "origin/main", sections = ALL_SECTIONS } = {}) {
  const selected = new Set(sections);
  const plan = [
    internalStep(
      "preflight.node",
      "preflight",
      `Use repository-pinned Node.js ${REQUIRED_NODE_VERSION}`,
      `node ${REQUIRED_NODE_VERSION}`,
      "node-version"
    ),
    internalStep(
      "preflight.npm",
      "preflight",
      `Use repository-pinned npm ${REQUIRED_NPM_VERSION}`,
      `npm ${REQUIRED_NPM_VERSION}`,
      "npm-version"
    )
  ];

  const add = (step) => {
    if (selected.has(step.section)) {
      plan.push(step);
    }
  };

  add(commandStep("policy.diff", "policy", "Validate the working diff", "git", ["diff", "--check"]));
  add(commandStep(
    "policy.freeze-tests",
    "policy",
    "Test the financial-freeze policy",
    "node",
    ["--test", "scripts/check-financial-freeze.test.mjs"]
  ));
  add(commandStep(
    "policy.freeze",
    "policy",
    "Enforce the financial freeze",
    "node",
    ["scripts/check-financial-freeze.mjs", "--base", base]
  ));
  add(commandStep(
    "policy.audit-tests",
    "policy",
    "Test the npm-audit policy",
    "node",
    ["--test", ".github/scripts/check-npm-audit.test.mjs"]
  ));
  for (const project of ["backend", "frontend", "e2e"]) {
    add(commandStep(
      `policy.audit-${project}`,
      "policy",
      `Audit ${project} production dependencies`,
      "node",
      [".github/scripts/check-npm-audit.mjs", project]
    ));
  }

  add(commandStep(
    "backend.install",
    "backend",
    "Clean-install backend dependencies",
    "npm",
    ["ci"],
    { cwd: resolve(repositoryRoot, "backend") }
  ));
  add(commandStep(
    "backend.lint",
    "backend",
    "Run backend ESLint",
    "npm",
    ["run", "lint"],
    { cwd: resolve(repositoryRoot, "backend") }
  ));
  add(commandStep(
    "backend.typecheck",
    "backend",
    "Typecheck the backend",
    "npm",
    ["run", "typecheck"],
    { cwd: resolve(repositoryRoot, "backend") }
  ));
  add(commandStep(
    "backend.build",
    "backend",
    "Build the backend",
    "npm",
    ["run", "build"],
    { cwd: resolve(repositoryRoot, "backend") }
  ));
  add(internalStep(
    "backend.services",
    "backend",
    "Start isolated PostgreSQL 16 and Redis 7",
    "docker run --rm postgres:16-alpine and redis:7-alpine; wait for health",
    "start-services"
  ));
  add(commandStep(
    "backend.migrate-1",
    "backend",
    "Apply migrations to the clean isolated database",
    "npm",
    ["run", "migrate:deploy"],
    { cwd: resolve(repositoryRoot, "backend"), environment: "backend-test" }
  ));
  add(commandStep(
    "backend.migrate-2",
    "backend",
    "Verify migrations are repeatable",
    "npm",
    ["run", "migrate:deploy"],
    { cwd: resolve(repositoryRoot, "backend"), environment: "backend-test" }
  ));
  add(commandStep(
    "backend.schema",
    "backend",
    "Run the schema contract",
    "npx",
    ["vitest", "run", "test/schema-contract.test.ts"],
    { cwd: resolve(repositoryRoot, "backend"), environment: "backend-test" }
  ));
  add(commandStep(
    "backend.tests",
    "backend",
    "Run all backend tests",
    "npm",
    ["test"],
    { cwd: resolve(repositoryRoot, "backend"), environment: "backend-test" }
  ));

  add(commandStep(
    "frontend.install",
    "frontend",
    "Clean-install frontend dependencies",
    "npm",
    ["ci"],
    { cwd: resolve(repositoryRoot, "frontend") }
  ));
  add(commandStep(
    "frontend.lint",
    "frontend",
    "Run frontend ESLint",
    "npm",
    ["run", "lint"],
    { cwd: resolve(repositoryRoot, "frontend") }
  ));
  add(commandStep(
    "frontend.typecheck",
    "frontend",
    "Typecheck the frontend",
    "npm",
    ["run", "typecheck"],
    { cwd: resolve(repositoryRoot, "frontend") }
  ));
  add(commandStep(
    "frontend.i18n",
    "frontend",
    "Validate the i18n contract",
    "npm",
    ["run", "i18n:check"],
    { cwd: resolve(repositoryRoot, "frontend") }
  ));
  add(commandStep(
    "frontend.tests",
    "frontend",
    "Run all frontend tests",
    "npm",
    ["test"],
    { cwd: resolve(repositoryRoot, "frontend") }
  ));
  add(commandStep(
    "frontend.build",
    "frontend",
    "Build the frontend",
    "npm",
    ["run", "build"],
    { cwd: resolve(repositoryRoot, "frontend"), environment: "frontend" }
  ));

  add(commandStep(
    "release.compose-production",
    "release",
    "Validate all production Compose profiles",
    "docker",
    ["compose", "--profile", "*", "config", "--quiet"],
    { environment: "compose" }
  ));
  add(commandStep(
    "release.compose-development",
    "release",
    "Validate development Compose",
    "docker",
    ["compose", "-f", "docker-compose.dev.yml", "config", "--quiet"],
    { environment: "compose" }
  ));
  add(commandStep(
    "release.compose-e2e",
    "release",
    "Validate isolated E2E Compose",
    "docker",
    ["compose", "-f", "docker-compose.e2e.yml", "config", "--quiet"],
    { environment: "compose" }
  ));
  add(commandStep(
    "release.images",
    "release",
    "Build all production images through Compose",
    "docker",
    ["compose", "--profile", "*", "build"],
    { environment: "compose" }
  ));
  add(commandStep(
    "release.e2e",
    "release",
    "Run the isolated Chromium E2E suite",
    "node",
    ["e2e/scripts/run.mjs"],
    { environment: "e2e" }
  ));
  add(internalStep(
    "release.gitleaks",
    "release",
    `Scan complete repository history with pinned Gitleaks ${GITLEAKS_VERSION}`,
    `gitleaks ${GITLEAKS_VERSION} git --redact --no-banner --config=.github/gitleaks.toml --gitleaks-ignore-path=.github/gitleaksignore --log-opts=--all .`,
    "gitleaks"
  ));
  add(commandStep("release.final-diff", "release", "Revalidate the final diff", "git", ["diff", "--check"]));
  add(commandStep(
    "release.final-freeze",
    "release",
    "Revalidate the final financial freeze",
    "node",
    ["scripts/check-financial-freeze.mjs", "--base", base]
  ));

  return plan;
}

export function parseArguments(argv) {
  const options = {
    base: "origin/main",
    dryRun: false,
    help: false,
    list: false,
    sections: [...ALL_SECTIONS]
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") {
      options.dryRun = true;
    } else if (argument === "--list") {
      options.list = true;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument === "--base") {
      const base = argv[index + 1];
      if (!base || base.startsWith("--")) {
        throw new Error("--base requires a Git ref");
      }
      options.base = base;
      index += 1;
    } else if (argument === "--only") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--only requires a comma-separated section list");
      }
      const sections = [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
      const invalid = sections.filter((section) => !ALL_SECTIONS.includes(section));
      if (sections.length === 0 || invalid.length > 0) {
        throw new Error(`--only accepts: ${ALL_SECTIONS.join(", ")}`);
      }
      options.sections = sections;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (options.list && options.dryRun) {
    throw new Error("Use either --list or --dry-run, not both");
  }
  return options;
}

function elapsedMilliseconds(startedAt) {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

export function formatDuration(milliseconds) {
  if (milliseconds < 1_000) {
    return `${Math.round(milliseconds)}ms`;
  }
  return `${(milliseconds / 1_000).toFixed(1)}s`;
}

function mergeEnvironment(extra = {}) {
  return { ...process.env, ...localOnlyEnvironment, ...extra };
}

export function environmentFor(step, services) {
  if (step.environment === "backend-test") {
    if (!services?.databaseUrl || !services?.redisUrl) {
      throw new Error("isolated database services are unavailable");
    }
    return mergeEnvironment({
      AUTHENTICATED_WRITE_RATE_LIMIT_PER_IP: "2000",
      AUTHENTICATED_WRITE_RATE_LIMIT_PER_MIN: "1000",
      DATABASE_URL: services.databaseUrl,
      FRONTEND_URL: "http://127.0.0.1:3000",
      JWT_SECRET: "verify-only-jwt-secret-aaaaaaaaaaaa",
      LOCAL_UPLOAD_DIR: "test-uploads",
      METRICS_PASSWORD: "verify-only-metrics-password",
      PUBLIC_BACKEND_URL: "http://127.0.0.1:4000",
      REDIS_URL: services.redisUrl,
      STORAGE_DRIVER: "local",
      TEST_DATABASE_URL: services.databaseUrl,
      TEST_REDIS_URL: services.redisUrl,
      TWO_FACTOR_ENCRYPTION_KEY: "1111111111111111111111111111111111111111111111111111111111111111"
    });
  }
  if (step.environment === "frontend") {
    return mergeEnvironment({ NODE_ENV: "production" });
  }
  if (step.environment === "compose") {
    return mergeEnvironment(productionComposeEnvironment);
  }
  if (step.environment === "e2e") {
    return mergeEnvironment({ CI: "true" });
  }
  return mergeEnvironment();
}

function spawnCommand(command, args, options = {}) {
  return new Promise((resolveResult) => {
    const invocation = commandInvocation(command, args);
    const child = spawn(invocation.command, invocation.args, {
      cwd: options.cwd ?? repositoryRoot,
      env: options.env ?? process.env,
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    if (options.capture) {
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
    }
    child.once("error", (error) => {
      resolveResult({ code: null, error, stderr, stdout });
    });
    child.once("close", (code, signal) => {
      resolveResult({ code, error: null, signal, stderr, stdout });
    });
  });
}

async function wait(milliseconds) {
  await new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

function portFromDockerOutput(output) {
  const match = output.trim().match(/:(\d+)$/m);
  if (!match) {
    throw new Error("Docker did not report a published port");
  }
  return match[1];
}

async function waitForContainer(containerName, probeArgs, attempts = 60) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const probe = await spawnCommand("docker", ["exec", containerName, ...probeArgs], { capture: true });
    if (probe.code === 0) {
      return;
    }
    await wait(1_000);
  }
  throw new Error(`${containerName} did not become healthy within ${attempts}s`);
}

export function isolatedPostgresArguments(name) {
  return [
    "run", "--detach", "--rm", "--name", name,
    // Disposable test state has no recovery value after this gate. Keep normal
    // PostgreSQL fsync semantics while avoiding host-volume fsync stalls on Windows.
    // Recovery/load certification uses a separate durable topology, never this one.
    "--tmpfs", "/var/lib/postgresql/data:rw,nosuid,size=1g",
    "--env", "POSTGRES_DB=marketplace_verify",
    "--env", "POSTGRES_USER=marketplace_verify",
    "--env", "POSTGRES_PASSWORD=verify-only-postgres-password",
    "--publish", "127.0.0.1::5432",
    "postgres:16-alpine"
  ];
}

async function startIsolatedServices() {
  const suffix = `${process.pid}-${randomBytes(4).toString("hex")}`;
  const postgresName = `keepgame-verify-postgres-${suffix}`;
  const redisName = `keepgame-verify-redis-${suffix}`;
  const services = { names: [postgresName, redisName] };

  const dockerInfo = await spawnCommand("docker", ["version", "--format", "{{.Server.Version}}"], { capture: true });
  if (dockerInfo.error) {
    const error = new Error("Docker CLI is unavailable");
    error.cause = dockerInfo.error;
    error.blocked = true;
    throw error;
  }
  if (dockerInfo.code !== 0) {
    const error = new Error("Docker daemon is unavailable");
    error.blocked = true;
    throw error;
  }

  try {
    const postgres = await spawnCommand("docker", isolatedPostgresArguments(postgresName), { capture: true });
    if (postgres.error || postgres.code !== 0) {
      throw new Error("Could not start the isolated PostgreSQL 16 container");
    }

    const redis = await spawnCommand("docker", [
      "run", "--detach", "--rm", "--name", redisName,
      "--publish", "127.0.0.1::6379",
      "redis:7-alpine", "redis-server", "--save", "", "--appendonly", "no"
    ], { capture: true });
    if (redis.error || redis.code !== 0) {
      throw new Error("Could not start the isolated Redis 7 container");
    }

    await waitForContainer(postgresName, ["pg_isready", "-U", "marketplace_verify", "-d", "marketplace_verify"]);
    await waitForContainer(redisName, ["redis-cli", "ping"]);

    const postgresPortResult = await spawnCommand("docker", ["port", postgresName, "5432/tcp"], { capture: true });
    const redisPortResult = await spawnCommand("docker", ["port", redisName, "6379/tcp"], { capture: true });
    if (postgresPortResult.code !== 0 || redisPortResult.code !== 0) {
      throw new Error("Could not resolve isolated service ports");
    }
    const postgresPort = portFromDockerOutput(postgresPortResult.stdout);
    const redisPort = portFromDockerOutput(redisPortResult.stdout);
    services.databaseUrl = `postgres://marketplace_verify:verify-only-postgres-password@127.0.0.1:${postgresPort}/marketplace_verify`;
    services.redisUrl = `redis://127.0.0.1:${redisPort}/0`;
    return services;
  } catch (error) {
    await stopIsolatedServices(services);
    throw error;
  }
}

async function stopIsolatedServices(services) {
  if (!services?.names?.length) {
    return { code: 0 };
  }
  const result = await spawnCommand("docker", ["rm", "--force", ...services.names], { capture: true });
  return result;
}

async function ensureGitleaks() {
  const assetKey = `${process.platform}-${process.arch}`;
  const asset = GITLEAKS_ASSETS[assetKey];
  if (!asset) {
    const error = new Error(`Pinned Gitleaks is not packaged for ${assetKey}`);
    error.blocked = true;
    throw error;
  }

  const installDirectory = join(tmpdir(), `keepgame-verify-gitleaks-v${GITLEAKS_VERSION}`, assetKey);
  const archivePath = join(installDirectory, asset.archive);
  const executablePath = join(installDirectory, asset.executable);
  await mkdir(installDirectory, { recursive: true });

  let archive;
  try {
    archive = await readFile(archivePath);
  } catch {
    const response = await fetch(`${GITLEAKS_RELEASE_BASE}/${asset.archive}`, { redirect: "follow" });
    if (!response.ok) {
      const error = new Error(`Gitleaks download returned HTTP ${response.status}`);
      error.blocked = true;
      throw error;
    }
    archive = Buffer.from(await response.arrayBuffer());
    await writeFile(archivePath, archive, { flag: "wx" }).catch(async (error) => {
      if (error.code !== "EEXIST") {
        throw error;
      }
      archive = await readFile(archivePath);
    });
  }

  const actualChecksum = createHash("sha256").update(archive).digest("hex");
  if (actualChecksum !== asset.checksum) {
    throw new Error(`Gitleaks archive checksum mismatch for ${asset.archive}`);
  }

  // Re-extract every run so execution always comes from the verified archive,
  // not from a potentially stale binary in the shared temporary directory.
  const extractionArgs = asset.archive.endsWith(".tar.gz")
    ? ["-xzf", archivePath, "-C", installDirectory, asset.executable]
    : ["-xf", archivePath, "-C", installDirectory, asset.executable];
  const extraction = await spawnCommand("tar", extractionArgs, { capture: true });
  if (extraction.error) {
    const error = new Error("A tar-compatible archive extractor is unavailable");
    error.blocked = true;
    throw error;
  }
  if (extraction.code !== 0) {
    throw new Error(`Could not extract pinned Gitleaks (${extraction.stderr.trim()})`);
  }
  if (process.platform !== "win32") {
    await chmod(executablePath, 0o755);
  }
  return executablePath;
}

function result(status, step, startedAt, extra = {}) {
  if (!ALLOWED_STATUSES.has(status)) {
    throw new Error(`Invalid verification status: ${status}`);
  }
  return {
    command: step.display,
    durationMs: elapsedMilliseconds(startedAt),
    exitCode: extra.exitCode ?? null,
    id: step.id,
    label: step.label,
    reason: extra.reason ?? "",
    status
  };
}

function logResult(item) {
  const exit = item.exitCode === null ? "-" : item.exitCode;
  const reason = item.reason ? `; ${item.reason}` : "";
  console.log(`[${item.status}] ${item.id} (exit=${exit}; duration=${formatDuration(item.durationMs)})${reason}`);
}

async function executeStep(step, state) {
  const startedAt = process.hrtime.bigint();
  console.log(`\n[RUN] ${step.id}: ${step.display}`);
  try {
    if (step.type === "node-version") {
      const actual = process.versions.node;
      const pinned = (await readFile(resolve(repositoryRoot, ".nvmrc"), "utf8")).trim();
      if (pinned !== REQUIRED_NODE_VERSION || actual !== pinned) {
        return result("BLOCKED", step, startedAt, {
          reason: `expected Node ${REQUIRED_NODE_VERSION} from .nvmrc, found ${actual}`
        });
      }
      return result("PASS", step, startedAt, { exitCode: 0 });
    }

    if (step.type === "npm-version") {
      const npm = await spawnCommand("npm", ["--version"], { capture: true });
      if (npm.error) {
        return result("BLOCKED", step, startedAt, { reason: npm.error.message });
      }
      const actual = npm.stdout.trim();
      if (npm.code !== 0 || actual !== REQUIRED_NPM_VERSION) {
        return result("BLOCKED", step, startedAt, {
          exitCode: npm.code,
          reason: `expected npm ${REQUIRED_NPM_VERSION}, found ${actual || "unknown"}`
        });
      }
      return result("PASS", step, startedAt, { exitCode: 0 });
    }

    if (step.type === "start-services") {
      state.services = await startIsolatedServices();
      return result("PASS", step, startedAt, { exitCode: 0 });
    }

    if (step.type === "gitleaks") {
      const executablePath = await ensureGitleaks();
      const scan = await spawnCommand(executablePath, [
        "git", "--redact", "--no-banner",
        "--config=.github/gitleaks.toml",
        "--gitleaks-ignore-path=.github/gitleaksignore",
        "--log-opts=--all", "."
      ], { cwd: repositoryRoot, env: mergeEnvironment() });
      if (scan.error) {
        return result("BLOCKED", step, startedAt, { reason: scan.error.message });
      }
      return result(scan.code === 0 ? "PASS" : "FAIL", step, startedAt, { exitCode: scan.code });
    }

    let environment;
    try {
      environment = environmentFor(step, state.services);
    } catch (error) {
      return result("BLOCKED", step, startedAt, { reason: error.message });
    }
    const command = await spawnCommand(step.command, step.args, {
      cwd: step.cwd,
      env: environment
    });
    if (command.error) {
      return result("BLOCKED", step, startedAt, { reason: command.error.message });
    }
    return result(command.code === 0 ? "PASS" : "FAIL", step, startedAt, { exitCode: command.code });
  } catch (error) {
    return result(error.blocked ? "BLOCKED" : "FAIL", step, startedAt, { reason: error.message });
  }
}

function printPlan(plan, status) {
  for (const step of plan) {
    console.log(`[${status}] ${step.id}: ${step.display}`);
  }
}

function printSummary(results, totalDurationMs) {
  console.log("\nVerification summary");
  console.log("STATUS\tEXIT\tDURATION\tSTEP");
  for (const item of results) {
    console.log(`${item.status}\t${item.exitCode ?? "-"}\t${formatDuration(item.durationMs)}\t${item.id}`);
  }
  const counts = Object.fromEntries([...ALLOWED_STATUSES].map((status) => [status, 0]));
  for (const item of results) {
    counts[item.status] += 1;
  }
  console.log(
    `TOTAL\t-\t${formatDuration(totalDurationMs)}\t` +
    `PASS=${counts.PASS} FAIL=${counts.FAIL} BLOCKED=${counts.BLOCKED} NOT_RUN=${counts["NOT RUN"]}`
  );
}

export async function runVerification(options) {
  const plan = createPlan(options);
  if (options.list) {
    printPlan(plan, "NOT RUN");
    return 0;
  }
  if (options.dryRun) {
    console.log("Dry run: no commands, containers, downloads, or provider calls will be made.");
    printPlan(plan, "NOT RUN");
    return 0;
  }

  const totalStartedAt = process.hrtime.bigint();
  const results = [];
  const state = { services: null };
  let stoppedEarly = false;

  try {
    for (let index = 0; index < plan.length; index += 1) {
      const step = plan[index];
      const item = await executeStep(step, state);
      results.push(item);
      logResult(item);
      if (item.status !== "PASS") {
        stoppedEarly = true;
        for (const remaining of plan.slice(index + 1)) {
          results.push({
            command: remaining.display,
            durationMs: 0,
            exitCode: null,
            id: remaining.id,
            label: remaining.label,
            reason: `required step ${step.id} did not pass`,
            status: "BLOCKED"
          });
        }
        break;
      }
    }
  } finally {
    if (state.services) {
      const cleanupStartedAt = process.hrtime.bigint();
      const cleanupStep = internalStep(
        "backend.services-cleanup",
        "backend",
        "Remove only this run's isolated containers",
        `docker rm --force ${state.services.names.join(" ")}`,
        "cleanup"
      );
      const cleanup = await stopIsolatedServices(state.services);
      const cleanupResult = result(cleanup.error ? "BLOCKED" : cleanup.code === 0 ? "PASS" : "FAIL", cleanupStep, cleanupStartedAt, {
        exitCode: cleanup.code,
        reason: cleanup.error?.message ?? ""
      });
      results.push(cleanupResult);
      logResult(cleanupResult);
    }
  }

  const totalDurationMs = elapsedMilliseconds(totalStartedAt);
  printSummary(results, totalDurationMs);
  const cleanupFailed = results.some((item) => item.id === "backend.services-cleanup" && item.status !== "PASS");
  const blocked = results.some((item) => item.status === "BLOCKED");
  const failed = results.some((item) => item.status === "FAIL");
  if (failed || cleanupFailed) {
    return 1;
  }
  if (blocked || stoppedEarly) {
    return 2;
  }
  return 0;
}

function printHelp() {
  console.log(`Usage: node scripts/verify-all.mjs [options]

Runs the complete D5 gate from the repository root. No real provider credentials
are needed or used; backend state is isolated in disposable PostgreSQL 16 and
Redis 7 containers.

Options:
  --base <ref>       Financial-freeze comparison base (default: origin/main)
  --only <sections>  Comma-separated policy,backend,frontend,release sections
  --list             List the exact plan without executing it
  --dry-run          Print the plan without commands, downloads, or containers
  --help, -h         Show this help
`);
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(`verify-all: ${error.message}`);
    printHelp();
    return 2;
  }
  if (options.help) {
    printHelp();
    return 0;
  }
  return runVerification(options);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  process.exitCode = await main();
}
