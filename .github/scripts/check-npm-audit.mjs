import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIR, "..", "..");
const ALLOWLIST_PATH = join(REPOSITORY_ROOT, ".github", "npm-audit-allowlist.json");
const SEVERITY_RANK = Object.freeze({ info: 0, low: 1, moderate: 2, high: 3, critical: 4 });
const DOC_REFERENCE_PATTERN = /^(docs\/security\/[0-9a-z][0-9a-z._/-]*\.md)#([0-9a-z][0-9a-z-]*)$/i;

function severityRank(severity) {
  return SEVERITY_RANK[String(severity).toLowerCase()] ?? -1;
}

export function extractAdvisoryId(url) {
  if (typeof url !== "string") return null;
  return url.match(/\/advisories\/(GHSA-[0-9a-z-]+)(?:[/?#]|$)/i)?.[1]?.toUpperCase() ?? null;
}

function normalizeConcreteAdvisory(via) {
  const id = extractAdvisoryId(via.url) ?? (via.source ? `NPM-${via.source}` : null);
  return {
    id,
    package: typeof via.name === "string" ? via.name : null,
    severity: String(via.severity ?? "").toLowerCase(),
    title: typeof via.title === "string" ? via.title : "",
    url: typeof via.url === "string" ? via.url : ""
  };
}

export function collectConcreteAdvisories(report) {
  const advisories = new Map();
  for (const vulnerability of Object.values(report.vulnerabilities ?? {})) {
    for (const via of vulnerability?.via ?? []) {
      if (!via || typeof via !== "object") continue;
      const advisory = normalizeConcreteAdvisory(via);
      const key = `${advisory.package ?? "unknown"}:${advisory.id ?? advisory.url ?? advisory.title}`;
      advisories.set(key, advisory);
    }
  }
  return [...advisories.values()];
}

function resolveConcreteAdvisories(report, packageName, visited = new Set()) {
  if (visited.has(packageName)) return [];
  visited.add(packageName);

  const vulnerability = report.vulnerabilities?.[packageName];
  if (!vulnerability) return [];

  const resolved = [];
  for (const via of vulnerability.via ?? []) {
    if (via && typeof via === "object") {
      resolved.push(normalizeConcreteAdvisory(via));
    } else if (typeof via === "string") {
      resolved.push(...resolveConcreteAdvisories(report, via, visited));
    }
  }
  return resolved;
}

function parseExpiry(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const endOfDay = new Date(`${value}T23:59:59.999Z`);
  if (Number.isNaN(endOfDay.valueOf()) || endOfDay.toISOString().slice(0, 10) !== value) return null;
  return endOfDay;
}

function parseDocumentationReference(value) {
  if (typeof value !== "string") return null;
  const match = value.match(DOC_REFERENCE_PATTERN);
  if (!match) return null;
  const segments = match[1].split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null;
  return { path: match[1], anchor: match[2] };
}

export function validateReferenceTargets(
  entries,
  loadReference = (relativePath) => readFileSync(join(REPOSITORY_ROOT, relativePath), "utf8")
) {
  if (!Array.isArray(entries)) return [];

  const failures = [];
  for (const [index, entry] of entries.entries()) {
    const parsed = parseDocumentationReference(entry?.reference);
    if (!parsed) continue;

    let document;
    try {
      document = loadReference(parsed.path);
    } catch {
      failures.push(`allowlist entry ${index + 1} references missing document ${parsed.path}`);
      continue;
    }

    const explicitAnchor = `<a id="${parsed.anchor}"></a>`;
    if (!String(document).includes(explicitAnchor)) {
      failures.push(`allowlist entry ${index + 1} references missing anchor ${entry.reference}`);
    }
  }
  return failures;
}

function validateAllowlist(entries, now, failures) {
  if (!Array.isArray(entries)) {
    failures.push("allowlist project entry must be an array");
    return new Map();
  }

  const validated = new Map();
  for (const [index, entry] of entries.entries()) {
    const label = `allowlist entry ${index + 1}`;
    const advisory = typeof entry?.advisory === "string" ? entry.advisory.toUpperCase() : "";
    const packageName = typeof entry?.package === "string" ? entry.package.trim() : "";
    const reference = typeof entry?.reference === "string" ? entry.reference.trim() : "";
    const expiry = parseExpiry(entry?.expires);

    if (!/^GHSA-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(advisory)) {
      failures.push(`${label} has an invalid advisory ID`);
    }
    if (!packageName) failures.push(`${label} has no package`);
    if (entry?.maxSeverity !== "high") failures.push(`${label} must set maxSeverity to high`);
    if (!parseDocumentationReference(reference)) {
      failures.push(`${label} must have a safe docs/security/*.md#... reference`);
    }
    if (!expiry) {
      failures.push(`${label} has an invalid expiry date`);
    } else if (now > expiry) {
      failures.push(`${label} expired on ${entry.expires}`);
    }

    const key = `${packageName}:${advisory}`;
    if (validated.has(key)) failures.push(`${label} duplicates ${key}`);
    if (advisory && packageName && entry?.maxSeverity === "high" && reference && expiry) {
      validated.set(key, { ...entry, advisory, package: packageName, expiry });
    }
  }
  return validated;
}

export function evaluateAuditPolicy(report, allowlistEntries, now = new Date()) {
  const failures = [];
  if (!report || typeof report !== "object" || !report.vulnerabilities || typeof report.vulnerabilities !== "object") {
    return { failures: ["npm audit JSON is missing the vulnerabilities object"], moderate: [], allowed: [] };
  }

  const allowlist = validateAllowlist(allowlistEntries, now, failures);
  const usedAllowlistKeys = new Set();
  const concrete = collectConcreteAdvisories(report);
  const moderate = concrete.filter((item) => item.severity === "moderate");
  const highOrCritical = concrete.filter((item) => severityRank(item.severity) >= SEVERITY_RANK.high);
  const allowed = [];

  for (const advisory of highOrCritical) {
    if (!advisory.id?.startsWith("GHSA-") || !advisory.package) {
      failures.push(`unkeyed ${advisory.severity} advisory for ${advisory.package ?? "unknown package"}`);
      continue;
    }

    const key = `${advisory.package}:${advisory.id}`;
    const exception = allowlist.get(key);
    if (!exception) {
      failures.push(`new ${advisory.severity} advisory ${advisory.id} for ${advisory.package}`);
      continue;
    }

    usedAllowlistKeys.add(key);
    if (severityRank(advisory.severity) > severityRank(exception.maxSeverity)) {
      failures.push(
        `${advisory.id} for ${advisory.package} escalated to ${advisory.severity} (allowed only through ${exception.maxSeverity})`
      );
      continue;
    }
    allowed.push({ ...advisory, expires: exception.expires, reference: exception.reference });
  }

  for (const [packageName, vulnerability] of Object.entries(report.vulnerabilities)) {
    if (severityRank(vulnerability?.severity) < SEVERITY_RANK.high) continue;
    const roots = resolveConcreteAdvisories(report, packageName).filter(
      (item) => severityRank(item.severity) >= SEVERITY_RANK.high
    );
    if (roots.length === 0) {
      failures.push(`${packageName} is ${vulnerability.severity}, but npm supplied no concrete high/critical advisory`);
    }
  }

  for (const key of allowlist.keys()) {
    if (!usedAllowlistKeys.has(key)) failures.push(`unused allowlist entry ${key}`);
  }

  return { failures: [...new Set(failures)], moderate, allowed };
}

function diagnosticText(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 1200);
}

export function parseAuditProcessResult(result) {
  if (result.error) throw new Error(`npm audit could not start: ${result.error.message}`);
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`npm audit tool/network failure (exit ${String(result.status)}): ${diagnosticText(result.stderr)}`);
  }

  let report;
  try {
    report = JSON.parse(String(result.stdout ?? "").trim());
  } catch (error) {
    throw new Error(`npm audit returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!report?.vulnerabilities || !report?.metadata?.vulnerabilities) {
    throw new Error(`npm audit returned an error document instead of an audit report: ${diagnosticText(result.stdout)}`);
  }
  return report;
}

function printSummary(project, report, result) {
  const counts = report.metadata.vulnerabilities;
  console.log(
    `[npm-audit:${project}] total=${counts.total} low=${counts.low} moderate=${counts.moderate} high=${counts.high} critical=${counts.critical}`
  );
  for (const advisory of result.moderate.sort((a, b) => `${a.package}:${a.id}`.localeCompare(`${b.package}:${b.id}`))) {
    console.log(`[npm-audit:${project}] moderate ${advisory.id ?? "unknown"} ${advisory.package ?? "unknown"}`);
  }
  for (const advisory of result.allowed.sort((a, b) => `${a.package}:${a.id}`.localeCompare(`${b.package}:${b.id}`))) {
    console.log(
      `[npm-audit:${project}] allowed ${advisory.severity} ${advisory.id} ${advisory.package} expires=${advisory.expires} reference=${advisory.reference}`
    );
  }
}

export function runAudit(project) {
  const allowlistDocument = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
  if (allowlistDocument.schemaVersion !== 1) throw new Error("unsupported npm audit allowlist schemaVersion");
  const entries = allowlistDocument.projects?.[project];
  if (!entries) throw new Error(`unknown project ${project}`);

  const auditArguments = ["audit", "--omit=dev", "--audit-level=high", "--json"];
  const npmExecutable = process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : "npm";
  const npmArguments =
    process.platform === "win32"
      ? ["/d", "/s", "/c", `npm.cmd ${auditArguments.join(" ")}`]
      : auditArguments;
  const processResult = spawnSync(
    npmExecutable,
    npmArguments,
    {
      cwd: join(REPOSITORY_ROOT, project),
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true
    }
  );
  const report = parseAuditProcessResult(processResult);
  const result = evaluateAuditPolicy(report, entries);
  result.failures.push(...validateReferenceTargets(entries));
  result.failures = [...new Set(result.failures)];
  printSummary(project, report, result);
  if (result.failures.length > 0) {
    throw new Error(`npm audit policy failed:\n- ${result.failures.join("\n- ")}`);
  }
}

const invokedAsScript = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invokedAsScript) {
  try {
    runAudit(process.argv[2]);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
