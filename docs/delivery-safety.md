# Direct-to-main delivery safety

Review date: **2026-08-27**
Evidence SHA: `effe378949bd0f246abb96b60dad2e83ff86ed38`

This task keeps the user's direct-to-`main` workflow. It does not claim that a source
configuration can replace repository-admin or deployment-provider controls.

## Verified current state

| Control | Status | Evidence |
| --- | --- | --- |
| Exact-SHA CI | PASS | GitHub Actions run `33084105336` completed successfully for the evidence SHA: 10/10 jobs, including Docker and E2E. |
| `main` protection | FAIL | The public GitHub branch API returned `protected: false`. |
| Repository rulesets | FAIL | The public repository-rulesets API returned an empty list. |
| CodeQL default setup | BLOCKED | The authenticated default-setup endpoint returned `401`; the public Actions workflow list showed no CodeQL workflow, but that is not sufficient proof that organization-level/default setup is disabled. |
| Renovate activation | BLOCKED | Repository configuration can be validated locally; installing or approving the GitHub App requires an owner. |
| Production promotion gate | BLOCKED | Provider settings and environment classification are not available with the current access. |

The evidence SHA also exposes the direct-main timing risk. A Vercel deployment status was
marked complete at `14:46:35Z`, a Railway status for `api.skrynia.xyz` at `14:47:09Z`, and a
second Vercel status at `14:48:22Z`. Exact-SHA CI completed at `14:54:43Z`. This proves that
deployment statuses completed before CI; it does **not** prove which Vercel/Railway
environment each status represented. Until an owner verifies and changes the provider
settings, unverified production promotion remains a release blocker.

## Required GitHub ruleset (manual owner action)

1. Authenticate as a repository administrator and export the current repository- and
   organization-level ruleset/branch settings for rollback.
2. Create one active branch ruleset targeting only `refs/heads/main`.
3. Enable branch deletion protection, non-fast-forward protection (no force pushes), and
   required linear history.
4. Do not add a pull-request-only rule while direct pushes remain an explicit requirement.
5. Read the effective rules back through the authenticated API and test a normal
   fast-forward push plus rejected deletion/non-fast-forward attempts in a safe repository
   or disposable branch policy test. Do not test destructive operations on `main`.
6. Record the ruleset ID and redacted before/after export. Roll back by restoring the export,
   not by reverting a Git commit.

Status: **BLOCKED** until an authenticated owner performs and verifies these steps.

## Required Vercel/Railway promotion gate (manual owner action)

For every project/environment that can serve production traffic, configure promotion so the
exact commit cannot become production until the GitHub Actions `CI` workflow for that same
SHA has completed successfully. A provider build or preview may run earlier, but production
traffic must remain on the previous green SHA. Do not treat a generic commit status as proof
of environment type.

At the next milestone push, capture provider start/promotion timestamps and the CI run's
`head_sha`, status, and completion time. PASS requires the production promotion timestamp to
be later than successful CI completion and all values to reference the same SHA. A red or
cancelled CI run must leave the previous production SHA active.

Status: **BLOCKED** until Vercel and Railway owners verify the settings and a milestone push
demonstrates the ordering. Rollback is provider-specific: restore the exported settings and
promote the last known green SHA; Git revert alone does not undo provider state.

## CodeQL and Renovate external activation

- Before enabling another CodeQL mode, an authenticated owner must inspect default setup and
  organization policy. Keep exactly one setup. The tracked advanced workflow may be used only
  when it does not duplicate a provider-managed scan.
- Install only Renovate, approve the least repository permissions it needs, and verify its
  Dependency Dashboard/dry run. Do not install Dependabot or enable automerge.

Both activation checks remain **BLOCKED** until owner access exists. Local workflow/config
validation is evidence about syntax only, not about provider execution.
