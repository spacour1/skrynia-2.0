# Production npm audit debt

This document records the narrow, temporary exceptions used by the production-dependency
audit gate. The gate still reports moderate findings and fails on any new high/critical
advisory, a severity escalation, an expired exception, a malformed/tool-error response, or
an exception that is no longer used.

Current review date: **2026-09-11**. There are no active high/critical exceptions. All three
project arrays in `.github/npm-audit-allowlist.json` are empty. Any future exception must be
short-lived and requires a new review, updated evidence, and an explicit documentation
change. Package-name-wide exceptions are prohibited; CI matches the exact project, package,
and GHSA identifier.

On 2026-07-24 the registry began returning four additional high advisories for the unchanged
frontend lockfile. The policy rejected them before this review. They are recorded below as
individual, expiring exceptions; this does not turn the gate into a package-wide Next.js or
PostCSS exception.

## Historical baseline commands and counts

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

## Resolved Sentry and Rollup debt on 2026-08-27

The expired `GHSA-mw96-cpmx-2vgc` exception was removed instead of renewed. Frontend
`@sentry/nextjs` and backend `@sentry/node` were moved together from `8.55.2` to the exact
`10.54.0` security floor after reviewing the official v8-to-v9 and v9-to-v10 migration
notes. `10.40.0` is the first npm high-free Sentry floor, but `10.54.0` is the first tested
floor that also removes the Sentry/OpenTelemetry and UUID moderate advisory chain. It remains
compatible with the repository's Next.js 15, React 19, TypeScript 5, and Node.js 20 runtime.

The resulting lockfiles resolve:

- frontend `@sentry/nextjs@10.54.0`, `rollup@4.63.0`,
  `@sentry/webpack-plugin@5.4.0`, and `@sentry/bundler-plugin-core@5.3.0`;
- backend `@sentry/node@10.54.0`, `@sentry/core@10.54.0`, and
  `@sentry/opentelemetry@10.54.0`.

The removed `hideSourceMaps` option is not carried forward. Builds without a complete
Sentry upload credential set explicitly disable source-map generation. Builds with an auth
token, organization, and project upload maps and set
`sourcemaps.deleteSourcemapsAfterUpload: true`. Frontend runtime configuration explicitly
disables default PII collection and sanitizes request, user, breadcrumb, transaction,
context, and extra data. The existing backend request/event sanitizer remains in place, and
backend default PII collection is now explicitly disabled.

Fresh Node.js 20 policy results after lockfile resolution:

| Project | Status | low | moderate | high | critical | total package findings |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Backend | PASS | 1 | 0 | 0 | 0 | 1 |
| Frontend | PASS | 0 | 3 | 0 | 0 | 3 |
| E2E | PASS | 0 | 0 | 0 | 0 | 0 |

The remaining frontend moderate aggregate consists of concrete DOMPurify
`GHSA-55q2-fjhq-7xh7` and PostCSS `GHSA-fxqj-rqcc-2cmp` findings; npm also reports the
affected Next.js aggregate through PostCSS. The remaining backend low finding is
`body-parser`. They stay visible and are not allowlisted. A dedicated weekly workflow now
runs the fail-closed audit policy even when no application commit occurs.

## Resolved security release drift on 2026-09-11

The production-dependency policy rejected newly reported advisories in the existing
lockfiles. Before remediation the backend raw audit reported `3 moderate / 1 high`
package findings; the frontend reported `4 moderate / 2 high / 1 critical`. The change
uses only the nearest compatible security releases, without adding audit exceptions:

- Backend Sharp and the frontend Sharp override move from `0.35.3` to exact `0.35.4`.
  This resolves
  [`GHSA-rgj7-g3m4-5g8c`](https://github.com/lovell/sharp/security/advisories/GHSA-rgj7-g3m4-5g8c)
  through the patched bundled libheif `1.23.2`. The lockfiles contain matching
  `@img/sharp-* 0.35.4` and `@img/sharp-libvips-* 1.3.3` packages for each supported
  platform. The WASM package requires its own `@emnapi/runtime@1.11.3`; the pre-existing
  top-level `1.11.1` version remains unchanged.
- Next.js and its ESLint configuration move together from `15.5.23` to exact
  `15.5.25`. The security floor `15.5.24` fixes
  [`GHSA-p293-qw3h-jr36`](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36)
  (Windows-hosted server RCE) and
  [`GHSA-2xp9-vwfh-vxw4`](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4)
  (AVIF image-optimization RCE). The narrow
  [`15.5.25` follow-up](https://github.com/vercel/next.js/releases/tag/v15.5.25)
  safely restores AVIF optimization when patched Sharp is installed. The explicit
  Sharp override remains because Next's optional range also permits older `0.34.x`.
- Frontend Browserslist moves from `4.28.4` to the exact patched floor `4.28.7`, fixing
  [`GHSA-c83g-rgw3-j3cx`](https://github.com/browserslist/browserslist/security/advisories/GHSA-c83g-rgw3-j3cx)
  and
  [`GHSA-73wf-gq98-2v4g`](https://github.com/browserslist/browserslist/security/advisories/GHSA-73wf-gq98-2v4g).
  Its required browser-data dependencies also update: `baseline-browser-mapping`,
  `caniuse-lite`, `electron-to-chromium`, and `node-releases`.

The declared engines remain compatible with the pinned Node.js `20.20.2`: Sharp
requires `>=20.9.0`, Next.js permits `>=20.0.0`, and Browserslist permits this runtime.
The lock diff contains only these dependency families and their required children,
plus npm's recomputed development/optional metadata. Unrelated package versions,
including Express, PostgreSQL, Redis, validation, and provider dependencies, are unchanged.
Financial implementation and the financial-freeze configuration are untouched.

Evidence for the updated lockfiles, based on `cc1ec8b31ee481beb6c420ea12c4b5bd8a80b729`
plus this dependency patch, using Node.js `20.20.2` / npm `10.8.2`:

| Command | Status | Exit | Duration | Production findings |
| --- | --- | ---: | ---: | --- |
| `npm install --package-lock-only --ignore-scripts --no-fund` in backend | PASS | 0 | 3.79s | Lockfile resolution only |
| Same command in frontend | PASS | 0 | 8.39s | Lockfile resolution only |
| `node .github/scripts/check-npm-audit.mjs backend` | PASS | 0 | 1.64s | 3 moderate, 0 high, 0 critical |
| `node .github/scripts/check-npm-audit.mjs frontend` | PASS | 0 | 2.52s | 4 moderate, 0 high, 0 critical |

Remaining moderate roots are backend `qs` (`GHSA-4mjr-xmp4-gh2g`,
`GHSA-x5fp-wj9c-mxmx`) and frontend DOMPurify, fflate, and PostCSS. They are reported,
not suppressed; the Next.js moderate aggregate comes from PostCSS. Existing
`node_modules` were deliberately not modified while the first backend suite was running.
The coordinator subsequently completed clean installs on the new lockfiles:

| Runtime check, 2026-09-11 | Status | Evidence |
| --- | --- | --- |
| `node scripts/verify-all.mjs --only backend` | PASS | Exit 0; 62 files/649 tests, 231.7s; isolated migrations twice, schema contract, lint, typecheck and build; total 349.1s. |
| `node scripts/verify-all.mjs --only frontend` | PASS | Exit 0; 27 files/203 tests, 38.3s; Next 15.5.25 production build 121.9s; total 311.3s. |
| `node scripts/verify-all.mjs --only policy` | PASS | Exit 0; 45 freeze tests, 10 audit-policy tests; backend 3 moderate/frontend 4 moderate/E2E 0 production findings, no high/critical; total 221.7s. |
| Stage 8 accumulated release/E2E/exact-SHA CI | NOT RUN | Recorded in the Stage 8 milestone evidence before publication. |

These checks used the accumulated Stage 7/8 working tree on the parent SHA above;
this dependency-only commit is not a claim that its isolated tree received those
feature tests. The production audit excludes development-only dependencies; raw
clean-install reports still contain high development findings. Runtime tests are
not exploit reproductions or real-provider evidence.

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
