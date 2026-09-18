# Stage 8 — frontend production security policy

Pre-publication checkpoint: 2026-09-19. Parent Stage 7 commit:
`56c7fa2f762afa3354a0fff2cb4c3fcb2f84f5bd`.
Evidence below describes the working tree prepared for the Stage 8 commit. It does
not certify the subsequently committed SHA: that SHA must pass the full D5 and
GitHub Actions before publication is considered complete.

## Scope and verified boundaries

- Required production API/site/WebSocket URLs fail fast. Canonical sites require
  HTTPS and browser sockets WSS; server-side internal HTTP API rewrites remain valid.
  Isolated HTTP test builds have an explicit exception, never a production default.
- CSP supports report-only/enforce, bounded exact media origins, same-origin API
  and Sentry tunnel, the configured socket, and analytics origins only when enabled.
  Offline tests check PostHog routing against the installed SDK, including regional
  aliases, remote configuration, and an optional static-assets host.
- Nosniff, referrer, permissions, and frame protection apply to frontend routes.
  HSTS is opt-in after operator-confirmed HTTPS, without preload/subdomain commitment.
- Production CSP has no unsafe-eval. Existing static App Router hydration still
  requires inline scripts/styles: this is not a nonce-based strict XSS policy.
- Sentry source maps require complete upload configuration and are deleted after
  upload; absent configuration disables generation. Docker accepts the upload token
  only as an optional BuildKit secret, not an image argument or persisted variable.
- Production, development and isolated E2E environments are explicitly separated.
  The D5 runner uses production mode for Next builds and clears provider settings.
  Its disposable PostgreSQL tmpfs is bounded at 1 GiB, with normal PostgreSQL
  durability settings; it is not evidence of persistent-storage recovery.
- No financial implementation, provider callback, monetary field or policy exception
  is changed. No new migration, SaaS, broad frontend refactor or dependency upgrade.

Deployment prerequisites, rollout, rollback and build-secret instructions are in
[deployment.md](deployment.md#frontend-production-security-policy).

## Pre-commit evidence

Environment: Windows, Node 20.20.2/npm 10.8.2; Docker Linux production Next build,
two API replicas, worker/outbox, PostgreSQL 16 and Redis 7. Synthetic local fixtures
only; external providers disabled. Tests remove only their disposable stack.

| Control | Status | Evidence |
| --- | --- | --- |
| Frontend complete tests | PASS | `cd frontend; npm test`: 28 files, 205 tests, exit 0, 12.79s. Earlier overlapping Docker build run had one 5s chat timeout; standalone chat rerun passed 5/5 in 4.52s and full rerun passed without timeout changes. |
| Frontend lint/typecheck/i18n | PASS | Pre-commit runner exit 0 for each step: 58.2s/28.2s/4.1s. Existing warnings remain (64 lint, 25 i18n); no new suppression. |
| Production-browser CSP smoke | PASS | Isolated `node e2e/scripts/run.mjs tests/frontend-security-headers.spec.ts` through the runner's `environmentFor({environment:'e2e'})`: 2 Chromium tests, exit 0, 12.1s. Production image built successfully. |
| Browser acceptance | PASS | Real login POST, authenticated profile GET/PATCH and navigation, local PNG upload and decoded persisted avatar, connected WebSocket frame, enforced headers, no captured CSP violation or hydration/runtime error in those scenarios. |
| Verification runner tests | PASS | `node --test scripts/verify-all.test.mjs`: 9 tests, exit 0, 236.87ms. |
| Published exact-SHA D5 | NOT RUN | Must run after committing, using `node --test scripts/verify-all.test.mjs` and `node scripts/verify-all.mjs`; earlier dated checks are not a substitute. |
| Push / exact-SHA CI / CodeQL / deployment status | NOT RUN | Required after D5; report actual SHA and observed results, never infer green from workflow files. |
| Real HTTPS proxy/HSTS rollout | BLOCKED | No authorized HTTPS staging endpoint/operator guarantee supplied. Local HTTP tests intentionally omit HSTS. |
| Sentry release/source-map delivery | BLOCKED | No authorized provider upload/runtime verification. Local source-map configuration tests do not prove delivery. |
| PostHog event delivery/provider settings | BLOCKED | No authorized provider verification; analytics remains disabled without a configured key and is not a local release dependency. |

Initial smoke failures were test-contract errors, not suppressed security findings:
the login selector also matched Telegram login; use the exact submit button. An
upload URL is a temporary private preview; the persisted profile returns a different
public avatar URL after attachment. The test now checks that saved URL belongs to
the uploaded object and actually renders/serves an image. No storage/auth behavior
or CSP directive was weakened to pass the tests.

## Stage 7 exact-commit search follow-up

The isolated 20,000-product search benchmark ran at the parent SHA above (exit 0,
45.215s total), with 429,991 document terms and all seven expected search indexes.
Warm PostgreSQL tmpfs results: `cs2` 86.178ms, `valroant` 139.473ms, `account`
247.583ms execution; planning 3.199/0.896/1.234ms respectively. All had zero shared
block reads. This measures the search SQL family, not the full HTTP route or a
production capacity/SLO guarantee. No new speculative index was added.

Graphify AST refresh: exit 0, 4,040 nodes/11,107 edges. Scoped query for
`frontendSecurityEnvironment frontendSecurityHeaders createNextConfig` confirms the
new config-helper path and test callers; actual source files were reviewed directly.
Graph output remains ignored. No financial dependency was introduced.

## Publication and pause

First committed candidate `ea8f482b812a84dacf501c6ac50abeb40368a6b8` failed D5
(exit 1, 976.3s): 649 backend tests and 205 frontend tests passed, as did production
audits/builds, but E2E had 12 passes and one failure. Its CSP blocked the explicit
second-replica socket (`connect-src` allowed only the primary). Gitleaks and final
policy checks were not reached. That candidate was not pushed.

The follow-up permits a bounded, opt-in list of exact additional socket origins;
only the two-replica test overlay enables its internal secondary origin. No wildcard,
disabled CSP, test skip or weakened session-revocation assertion was introduced.
Five new unit regressions failed before this correction. Repeat targeted browser
checks, then the entire D5 on the new committed SHA before publishing.

Follow-up pre-commit checks on 2026-09-19: PASS, configuration tests 41/41 (2.01s),
frontend typecheck exit 0, runner tests 9/9 (266.59ms), financial freeze exit 0.
Joint production-browser run of `frontend-security-headers.spec.ts` and
`realtime-replicas.spec.ts`: PASS, 3/3 tests, 14.8s, exit 0. Both sockets connected
and both closed with the required session-revocation code/reason. Full D5 must
still be repeated on the committed follow-up SHA; no result is inferred from these
targeted checks.

The accumulated linear delivery is Stage 5, Stage 6, dependency remediation,
Stage 7, then Stage 8. Fetch before publication; if remote advances, integrate and
repeat D5. Never force-push or publish a red gate. After D5, push directly to main
as requested and inspect CI/CodeQL/statuses for that exact SHA.

The user's current instruction is to pause after this checkpoint. Stage 9 and later
are not authorized to start automatically. External blockers above remain explicit;
this checkpoint alone is not a final production-readiness certification.
