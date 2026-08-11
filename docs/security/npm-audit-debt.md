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

## Resolved Next.js runtime debt on 2026-08-11

Frontend `next` was upgraded from unsupported `14.2.35` to exact `15.5.23`, the current
Maintenance LTS backport. The security floor that clears the eight recorded direct Next.js
advisories was `15.5.21`; `15.5.23` remains in the nearest supported major line and includes
the subsequent maintenance fixes. See the official
[`Next.js support policy`](https://nextjs.org/support-policy) and
[`15.5.23` release](https://github.com/vercel/next.js/releases/tag/v15.5.23).

Because this project uses only the App Router, React and React DOM moved from `18.3.1` to
`19.2.8`, with matching React 19 types. The migration adopts promised route parameters in
layouts, pages, and metadata, and adds the required Suspense boundaries around search-param
consumers. `@sentry/nextjs@8.55.2` remains unchanged and explicitly supports Next 15; its
separate Rollup/build-tool debt stays recorded below.

Next `15.5.23` declares optional `sharp ^0.34.3`, which would otherwise install vulnerable
`sharp@0.34.5` and reintroduce `GHSA-f88m-g3jw-g9cj`. The frontend therefore overrides that
nested optional dependency to patched `sharp@0.35.3`; the clean dependency tree contains no
second Sharp copy. Standalone build coverage includes static generation, locale middleware,
fixed-host `/api/:path*` rewrites, auth return paths, password reset, metadata, real 404s,
the strict `/en` healthcheck, and the production Alpine image.

Immediately before this upgrade, the raw production audit reported
`0 low / 23 moderate / 3 high / 0 critical` findings (26 package findings). After the
upgrade it reports `0 low / 24 moderate / 2 high / 0 critical` (26 package findings): all
eight direct Next.js GHSA records are absent. The remaining two high package nodes are the
already-recorded Sentry/Rollup chain, while the Next package's remaining moderate aggregate
is inherited from PostCSS and stays visible for the toolchain stage. The eight exact Next.js
allowlist entries were removed; the audit-policy gate passes with only the existing Rollup
exception.

## Frontend exceptions

The remaining Sentry-related exception below requires the coordinated Sentry/toolchain
upgrade in the next stage. It must not be broadened into a package-wide exception.

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
   corresponding Sentry/OpenTelemetry and build-tool upgrades.
