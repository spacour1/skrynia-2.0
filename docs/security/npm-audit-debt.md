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
| Backend | `npm audit --omit=dev --audit-level=high --json` | FAIL, exit 1 before policy exceptions | 1 | 19 | 1 | 0 | 21 |
| Frontend | `npm audit --omit=dev --audit-level=high --json` | FAIL, exit 1 before policy exceptions | 1 | 20 | 9 | 0 | 30 |

The npm totals count vulnerable package nodes, not unique advisories. In particular,
`@sentry/nextjs` is a high aggregate node whose concrete high root is the Rollup advisory
listed below. The policy resolves npm's string-valued `via` chains and permits only concrete
GHSA records.

## Resolved registry drift on 2026-08-10

The unchanged lockfiles at `d47985a` began failing the audit gate in GitHub Actions run
[`31338684075`](https://github.com/spacour1/skrynia-2.0/actions/runs/31338684075) when the
registry published additional high advisories. They were fixed with compatible patch releases
instead of adding exceptions:

- backend `brace-expansion` was updated from 5.0.8 to 5.0.9, resolving
  `GHSA-rgw5-rvv9-x895`;
- frontend `brace-expansion` was updated from 2.1.2 to 2.1.4, resolving both
  `GHSA-mh99-v99m-4gvg` and `GHSA-rgw5-rvv9-x895`;
- frontend `fast-uri` was updated from 3.1.3 to 3.1.5, resolving both
  `GHSA-v2hh-gcrm-f6hx` and `GHSA-7p8r-x3mc-p8w7`;
- frontend `nanoid` was updated from 3.3.16 to 3.3.18, resolving
  `GHSA-2v37-7h3g-55p8`.

The obsolete `brace-expansion` and `fast-uri` frontend exceptions were removed in the same
change. At that point, the exact policy passed with backend counts
`1 low / 19 moderate / 1 high` and frontend counts `0 low / 23 moderate / 3 high`;
the then-remaining entries retained their original expiry.

## Resolved Sharp/libvips debt on 2026-08-11

Backend `sharp` was upgraded from `0.34.5` to `0.35.3`, which uses the patched bundled
libvips `8.18.3`. This is the version explicitly recommended by the maintainer for
[`GHSA-f88m-g3jw-g9cj`](https://github.com/lovell/sharp/security/advisories/GHSA-f88m-g3jw-g9cj),
not an upgrade selected only because it was newest. It remains in the nearest fixed
`0.35.x` line and also includes the ESM type-publication and additional input-bound
validation fixes from the intervening patch releases.

Sharp `0.35.3` requires Node.js `>=20.9.0`; the verified local and Alpine build runtime is
Node.js `20.20.2`. The lockfile installs `@img/sharp-* 0.35.3` and bundled
`@img/sharp-libvips-* 1.3.2`, including the Linux musl packages used by the production
Docker image. Upload regressions cover JPEG, PNG, WebP, magic bytes, corrupt input,
dimension and pixel limits, alpha, EXIF/orientation, file size, quotas, bounded processing,
provider/DB failures, cleanup, and the deletion outbox.

After the upgrade, `npm audit --omit=dev --audit-level=high --json` exits `0` with
`1 low / 19 moderate / 0 high / 0 critical` findings (20 total package findings). The exact
Sharp allowlist entry was removed and the audit-policy script must therefore reject any
regression of this advisory.

## Backend exceptions

There are currently no backend high/critical production-audit exceptions. Moderate
Sentry/OpenTelemetry findings and the low `body-parser` finding remain visible and are not
silently treated as resolved.

## Frontend exceptions

The remaining Sentry-related exception below requires a coordinated Sentry/toolchain update.
The Next exceptions require a supported Next.js upgrade and complete typecheck, unit,
production-build, and E2E verification; they must not be silently renewed because they affect
the public web runtime.

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
