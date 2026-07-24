# Production npm audit debt

This document records the narrow, temporary exceptions used by the production-dependency
audit gate. The gate still reports moderate findings and fails on any new high/critical
advisory, a severity escalation, an expired exception, a malformed/tool-error response, or
an exception that is no longer used.

Baseline date: **2026-07-24**. All exceptions expire at the end of **2026-08-21 UTC**.
Expiry is deliberately short: renewal requires a new review, updated evidence, and an
explicit documentation change. Package-name-wide exceptions are prohibited; CI matches the
exact project, package, and GHSA identifier.

On 2026-07-24 the registry began returning four additional high advisories for the unchanged
frontend lockfile. The policy rejected them before this review. They are recorded below as
individual, expiring exceptions; this does not turn the gate into a package-wide Next.js or
PostCSS exception.

## Baseline commands and counts

| Project | Command | Status | low | moderate | high | critical | total package findings |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| Backend | `npm audit --omit=dev --audit-level=high --json` | FAIL, exit 1 before policy exceptions | 1 | 19 | 2 | 0 | 22 |
| Frontend | `npm audit --omit=dev --audit-level=high --json` | FAIL, exit 1 before policy exceptions | 1 | 21 | 6 | 0 | 28 |

The npm totals count vulnerable package nodes, not unique advisories. In particular,
`@sentry/nextjs` is a high aggregate node whose concrete high root is the Rollup advisory
listed below. The policy resolves npm's string-valued `via` chains and permits only concrete
GHSA records.

## Backend exceptions

<a id="backend-ghsa-3jxr-9vmj-r5cp"></a>

### Backend GHSA-3jxr-9vmj-r5cp

- Affected path: `node-pg-migrate@8.0.4 -> glob@11.1.0 -> minimatch@10.2.5 -> brace-expansion@5.0.6`.
- Risk: exponential-time expansion can cause denial of service if attacker-controlled glob
  expressions reach this build/release dependency.
- Remediation owner: backend/runtime maintainers.
- Plan: refresh the lockfile to a patched transitive version and run clean/repeat migration,
  schema-contract, and full backend tests.
- Maximum allowed severity: high.
- Expiry: 2026-08-21.

<a id="backend-ghsa-f88m-g3jw-g9cj"></a>

### Backend GHSA-f88m-g3jw-g9cj

- Affected package: direct production dependency `sharp@0.34.5`.
- Risk: inherited libvips image-processing vulnerabilities affect untrusted uploaded images.
- Remediation owner: backend/storage maintainers.
- Plan: upgrade Sharp/libvips to a fixed release in a dedicated change and rerun upload,
  storage quota, image-dimension, backend build, and full backend tests.
- Maximum allowed severity: high.
- Expiry: 2026-08-21.

## Frontend exceptions

The Sentry-related exceptions below require a coordinated Sentry/toolchain update. The Next
exceptions require a supported Next.js upgrade and complete typecheck, unit, production-build,
and E2E verification; they must not be silently renewed because they affect the public web
runtime.

<a id="frontend-ghsa-3jxr-9vmj-r5cp"></a>

### Frontend GHSA-3jxr-9vmj-r5cp

- Affected path: `@sentry/nextjs@8.55.2 -> @sentry/webpack-plugin -> glob -> minimatch -> brace-expansion@2.1.1`.
- Remediation owner: frontend/observability maintainers.
- Plan: update the Sentry build toolchain or its patched transitive lock entry, then run the
  full frontend checks and production Docker build.
- Maximum allowed severity: high.
- Expiry: 2026-08-21.

<a id="frontend-ghsa-v2hh-gcrm-f6hx"></a>

### Frontend GHSA-v2hh-gcrm-f6hx

- Affected path: `@sentry/nextjs@8.55.2 -> webpack -> schema-utils -> ajv -> fast-uri@3.1.3`.
- Remediation owner: frontend/observability maintainers.
- Plan: move the Sentry/Webpack dependency graph to a patched `fast-uri` and rerun the
  frontend build plus Docker build.
- Maximum allowed severity: high.
- Expiry: 2026-08-21.

<a id="frontend-ghsa-h25m-26qc-wcjf"></a>

### Frontend GHSA-h25m-26qc-wcjf

- Affected package: direct `next@14.2.35` (HTTP request deserialization denial of service).
- Remediation owner: frontend runtime maintainers.
- Plan: coordinated supported Next.js upgrade with application-router regression coverage.
- Maximum allowed severity: high.
- Expiry: 2026-08-21.

<a id="frontend-ghsa-q4gf-8mx6-v5v3"></a>

### Frontend GHSA-q4gf-8mx6-v5v3

- Affected package: direct `next@14.2.35` (Server Components denial of service).
- Remediation owner: frontend runtime maintainers.
- Plan: coordinated supported Next.js upgrade with production-build and request-limit checks.
- Maximum allowed severity: high.
- Expiry: 2026-08-21.

<a id="frontend-ghsa-8h8q-6873-q5fj"></a>

### Frontend GHSA-8h8q-6873-q5fj

- Affected package: direct `next@14.2.35` (Server Components denial of service).
- Remediation owner: frontend runtime maintainers.
- Plan: coordinated supported Next.js upgrade and route-rendering regression tests.
- Maximum allowed severity: high.
- Expiry: 2026-08-21.

<a id="frontend-ghsa-c4j6-fc7j-m34r"></a>

### Frontend GHSA-c4j6-fc7j-m34r

- Affected package: direct `next@14.2.35` (WebSocket-upgrade server-side request forgery).
- Remediation owner: frontend runtime and security maintainers.
- Plan: coordinated supported Next.js upgrade, followed by proxy/rewrite and WebSocket smoke
  checks in the isolated E2E environment.
- Maximum allowed severity: high.
- Expiry: 2026-08-21.

<a id="frontend-ghsa-36qx-fr4f-26g5"></a>

### Frontend GHSA-36qx-fr4f-26g5

- Affected package: direct `next@14.2.35` (middleware/proxy authorization bypass advisory).
- Remediation owner: frontend runtime and security maintainers.
- Plan: coordinated supported Next.js upgrade and locale/auth middleware regression tests.
- Maximum allowed severity: high.
- Expiry: 2026-08-21.

<a id="frontend-ghsa-m99w-x7hq-7vfj"></a>

### Frontend GHSA-m99w-x7hq-7vfj

- Affected package: direct `next@14.2.35` (App Router Server Actions denial of service).
- Reachability evidence: the current frontend has no `"use server"` directive, so no
  application-defined Server Action was found; the installed Next.js version is nevertheless
  in the affected range and this is not treated as proof of non-exploitability.
- Remediation owner: frontend runtime maintainers.
- Plan: upgrade to a supported patched Next.js release and add bounded-request regression
  coverage before removing the exception.
- Maximum allowed severity: high.
- Expiry: 2026-08-21.

<a id="frontend-ghsa-89xv-2m56-2m9x"></a>

### Frontend GHSA-89xv-2m56-2m9x

- Affected package: direct `next@14.2.35` (Server Actions server-side request forgery on
  custom servers).
- Reachability evidence: the production image uses Next.js standalone output rather than an
  application custom server, and no `"use server"` directive was found. The affected
  dependency remains deployed, so the finding stays visible.
- Remediation owner: frontend runtime and security maintainers.
- Plan: include this advisory in the supported Next.js upgrade and rerun standalone Docker,
  proxy, and E2E security checks.
- Maximum allowed severity: high.
- Expiry: 2026-08-21.

<a id="frontend-ghsa-p9j2-gv94-2wf4"></a>

### Frontend GHSA-p9j2-gv94-2wf4

- Affected package: direct `next@14.2.35` (server-side request forgery through rewrites with
  an attacker-controlled destination hostname).
- Reachability evidence: `next.config.mjs` defines one `/api/:path*` rewrite whose destination
  hostname comes from the deployment-controlled `NEXT_PUBLIC_API_URL`; request input controls
  only the path segment. This reduces the known route's exposure but does not patch Next.js.
- Remediation owner: frontend runtime and security maintainers.
- Plan: upgrade Next.js, then verify fixed-host rewrite behavior and reject unsafe deployment
  configuration in production smoke/E2E checks.
- Maximum allowed severity: high.
- Expiry: 2026-08-21.

<a id="frontend-ghsa-6g55-p6wh-862q"></a>

### Frontend GHSA-6g55-p6wh-862q

- Affected path: `next@14.2.35 -> postcss@8.4.31` (arbitrary file read through an
  attacker-controlled CSS `sourceMappingURL`).
- Reachability evidence: current CSS inputs are repository-controlled and no endpoint that
  compiles user-provided CSS was found. The vulnerable package still processes build inputs.
- Remediation owner: frontend build and security maintainers.
- Plan: update the Next.js/PostCSS dependency graph to a patched PostCSS release, then rerun
  clean install, frontend unit/build, secret scan, and production Docker build.
- Maximum allowed severity: high.
- Expiry: 2026-08-21.

<a id="frontend-ghsa-mw96-cpmx-2vgc"></a>

### Frontend GHSA-mw96-cpmx-2vgc

- Affected path: `@sentry/nextjs@8.55.2 -> rollup@3.29.5` (build-time arbitrary file write).
- Remediation owner: frontend/observability and CI maintainers.
- Plan: coordinated Sentry/toolchain upgrade, then verify clean checkout, frontend build,
  source-map handling, and production Docker build.
- Maximum allowed severity: high.
- Expiry: 2026-08-21.

## Operating rules

1. Do not add `|| true`, `continue-on-error`, package-wide exceptions, or a critical
   exception.
2. A false positive requires evidence and an exact GHSA/package entry with an owner,
   remediation plan, reference, and expiry.
3. Remove an exception in the same change that fixes its advisory. The policy intentionally
   fails on unused entries.
4. A registry/network/tool failure is a CI failure, not a clean audit.
5. Moderate findings remain visible in every audit log and should be reduced during the
   corresponding Sentry/OpenTelemetry and Next.js upgrades.
