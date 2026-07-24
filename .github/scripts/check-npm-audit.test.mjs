import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateAuditPolicy,
  extractAdvisoryId,
  parseAuditProcessResult,
  validateReferenceTargets
} from "./check-npm-audit.mjs";

const auditDate = new Date("2026-07-24T12:00:00.000Z");

function advisory({ id, packageName = "example", severity = "high" }) {
  return {
    source: 1,
    name: packageName,
    dependency: packageName,
    title: `${packageName} advisory`,
    url: `https://github.com/advisories/${id}`,
    severity
  };
}

function auditReport(vulnerabilities, counts = { info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 }) {
  return { auditReportVersion: 2, vulnerabilities, metadata: { vulnerabilities: counts } };
}

function exception(overrides = {}) {
  return {
    advisory: "GHSA-1111-2222-3333",
    package: "example",
    maxSeverity: "high",
    expires: "2026-08-21",
    reference: "docs/security/npm-audit-debt.md#example-ghsa-1111-2222-3333",
    ...overrides
  };
}

test("extractAdvisoryId normalizes GitHub advisory URLs", () => {
  assert.equal(extractAdvisoryId("https://github.com/advisories/ghsa-1111-2222-3333"), "GHSA-1111-2222-3333");
  assert.equal(extractAdvisoryId("https://example.test/not-an-advisory"), null);
});

test("allows only the exact high advisory and reports moderate advisories", () => {
  const report = auditReport({
    example: { severity: "high", via: [advisory({ id: "GHSA-1111-2222-3333" })] },
    moderateDependency: {
      severity: "moderate",
      via: [advisory({ id: "GHSA-4444-5555-6666", packageName: "moderate-dependency", severity: "moderate" })]
    }
  });
  const result = evaluateAuditPolicy(report, [exception()], auditDate);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.allowed.map((item) => item.id), ["GHSA-1111-2222-3333"]);
  assert.deepEqual(result.moderate.map((item) => item.id), ["GHSA-4444-5555-6666"]);
});

test("fails a new high advisory", () => {
  const report = auditReport({
    example: { severity: "high", via: [advisory({ id: "GHSA-9999-8888-7777" })] }
  });
  const result = evaluateAuditPolicy(report, [], auditDate);
  assert.match(result.failures.join("\n"), /new high advisory GHSA-9999-8888-7777/);
});

test("fails severity escalation from high to critical", () => {
  const report = auditReport({
    example: { severity: "critical", via: [advisory({ id: "GHSA-1111-2222-3333", severity: "critical" })] }
  });
  const result = evaluateAuditPolicy(report, [exception()], auditDate);
  assert.match(result.failures.join("\n"), /escalated to critical/);
});

test("fails expired and unused exceptions", () => {
  const report = auditReport({});
  const result = evaluateAuditPolicy(report, [exception({ expires: "2026-07-22" })], auditDate);
  assert.match(result.failures.join("\n"), /expired on 2026-07-22/);
  assert.match(result.failures.join("\n"), /unused allowlist entry/);
});

test("requires a docs reference", () => {
  const report = auditReport({
    example: { severity: "high", via: [advisory({ id: "GHSA-1111-2222-3333" })] }
  });
  const result = evaluateAuditPolicy(report, [exception({ reference: "SEC-123" })], auditDate);
  assert.match(result.failures.join("\n"), /safe docs\/security/);
});

test("requires an existing documentation file and exact explicit anchor", () => {
  assert.deepEqual(
    validateReferenceTargets([exception()], (relativePath) => {
      assert.equal(relativePath, "docs/security/npm-audit-debt.md");
      return '<a id="example-ghsa-1111-2222-3333"></a>';
    }),
    []
  );
  assert.match(
    validateReferenceTargets([exception()], () => "# No matching anchor").join("\n"),
    /missing anchor/
  );
  assert.match(
    validateReferenceTargets([exception()], () => {
      throw new Error("missing");
    }).join("\n"),
    /missing document/
  );
});

test("matches exceptions by exact package and advisory", () => {
  const report = auditReport({
    example: { severity: "high", via: [advisory({ id: "GHSA-1111-2222-3333" })] }
  });
  const wrongPackage = evaluateAuditPolicy(report, [exception({ package: "other-package" })], auditDate);
  assert.match(wrongPackage.failures.join("\n"), /new high advisory/);
  assert.match(wrongPackage.failures.join("\n"), /unused allowlist entry/);

  const wrongAdvisory = evaluateAuditPolicy(
    report,
    [exception({ advisory: "GHSA-AAAA-BBBB-CCCC" })],
    auditDate
  );
  assert.match(wrongAdvisory.failures.join("\n"), /new high advisory/);
  assert.match(wrongAdvisory.failures.join("\n"), /unused allowlist entry/);
});

test("fails closed when an aggregate high has no concrete high advisory", () => {
  const report = auditReport({ aggregate: { severity: "high", via: ["missing-package"] } });
  const result = evaluateAuditPolicy(report, [], auditDate);
  assert.match(result.failures.join("\n"), /supplied no concrete high\/critical advisory/);
});

test("rejects npm tool failures and malformed/error JSON", () => {
  assert.throws(
    () => parseAuditProcessResult({ status: 2, stdout: "", stderr: "registry unavailable" }),
    /tool\/network failure/
  );
  assert.throws(() => parseAuditProcessResult({ status: 1, stdout: "not json", stderr: "" }), /invalid JSON/);
  assert.throws(
    () => parseAuditProcessResult({ status: 1, stdout: JSON.stringify({ error: { summary: "registry unavailable" } }), stderr: "" }),
    /error document/
  );
});
