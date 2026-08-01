# Graphify local pilot

## Installed baseline

- Date: 2026-08-01
- Graphify: `0.9.31` (minimum required: `0.9.27`)
- uv: `0.11.32`
- Installation: project-scoped Codex skill
- Generated output: local `graphify-out/`, intentionally excluded from Git

The repository commits the reusable Graphify skill, scoped navigation rules, and scan
ignore policy. The machine-specific advisory hook and installer backups remain local.

## First build

The initial direct `graphify .` run detected code, documents, and images. The first pilot
used the deterministic local AST path while the project-scoped Codex integration was
being verified:

```powershell
graphify extract . --code-only --force
graphify cluster-only . --no-label
```

The SQL parser extra was installed so migrations were not silently omitted.

| Result | Value |
| --- | ---: |
| Code files scanned | 480 |
| Graph nodes | 2,934 |
| Graph edges | 8,261 |
| Communities | 153 |
| Final graph missing/dangling endpoints | 0 |
| Final graph duplicate/collapsed edges | 0 |

Generated locally:

- `graphify-out/graph.json`
- `graphify-out/GRAPH_REPORT.md`
- `graphify-out/graph.html`

## Semantic document and image build

The project skill supports host-agent semantic extraction when no Gemini key is set.
No external LLM credential was configured or required. Codex split the non-code corpus
into two document chunks and seven individual image chunks, then merged those results
with a fresh local AST/SQL extraction.

| Result | Value |
| --- | ---: |
| Total files detected | 528 |
| Code and SQL files | 479 |
| Documents | 42 |
| Images | 7 |
| Semantic files covered | 49 / 49 |
| Semantic nodes | 159 |
| Semantic edges | 163 |
| Combined raw nodes | 3,098 |
| Combined raw edges | 9,317 |
| Final graph nodes | 3,098 |
| Final graph edges | 8,424 |
| Communities | 179 |
| Named communities | 179 / 179 |
| Final graph health warnings | 0 |
| Graphify token-reduction estimate | 9.3x |
| Incremental code update | 15.43 seconds |

The first host-agent semantic pass took approximately 20 minutes from corpus detection
to the final image chunk while three worker slots were reused in batches. Exact subagent
token telemetry was unavailable, so the generated cost record keeps token values at zero
and labels that limitation explicitly. Those zeroes mean "not measured," not zero model
usage. All 49 semantic files were cached for later runs.

The corpus exceeded the skill's 500-file warning threshold. Its five largest first-level
areas were `backend` (241 files), `frontend` (213), `docs` (22), `shared` (10), and `e2e`
(10). The user had explicitly requested full-repository coverage, so the build continued
with the complete 528-file corpus instead of narrowing to a subdirectory.

The raw pre-build diagnostic reported 678 dangling AST edges, 70 exact duplicate edges,
and 215 same-endpoint edges collapsed by the undirected graph build. The final graph
contains only valid endpoints, but these raw-extraction warnings remain part of the pilot
evidence and must not be hidden.

All 179 communities were given plain-language names before regenerating the report, JSON,
and HTML. The built graph passed the final multigraph diagnostic with no dangling
endpoints, self-loops, duplicates, or collapsed endpoint pairs. The raw extraction
warnings above remain recorded separately.

A subsequent `graphify update .` completed in 15.43 seconds, reported no topology
change, and preserved all 3,098 nodes, 8,424 edges, and 159 semantic nodes. The updater
also reported 46 source files that deterministically produce no AST nodes (primarily
locale/configuration data); it will retry those files on later updates.

## Smoke query evidence

The confidence counts below describe the traversal edges selected by Graphify's
depth-two BFS, not every edge induced by all returned nodes.

| Query | Nodes | Traversal edges | EXTRACTED | INFERRED | AMBIGUOUS | Useful anchors | False or missing evidence |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| Order confirmation, escrow, ledger, cache | 587 | 998 | 969 | 29 | 0 | `ledger.service.ts`, `order-transition.service.ts`, `marketplace-cache.service.ts` | Email-verification lead; no reviewed dependency confirmed missing |
| Password, sessions, refresh, WebSocket | 537 | 846 | 825 | 21 | 0 | `session.service.ts`, `changePasswordSchema`, WebSocket tests | Unrelated E2E helper lead; no reviewed dependency confirmed missing |
| Payment callback, provider, ledger, outbox | 701 | 1,247 | 1,209 | 38 | 0 | `payments.routes.ts`, `payment.providers.ts`, `ledger.service.ts`, `outbox.worker.ts` | Generic verification and E2E leads; no reviewed dependency confirmed missing |
| Audit finish, shutdown, PostgreSQL | 332 | 500 | 429 | 71 | 0 | `request-context.ts`, `api.ts`, `pool.ts` | Search-extension lead; shutdown-to-audit-drain edge is absent because the source call is genuinely missing |
| Shared DTOs, mappers, consumers | 722 | 1,154 | 1,102 | 52 | 0 | shared contracts, DTO parity tests, backend mappers, frontend API consumers | Formatting-script lead; no reviewed dependency confirmed missing |

The five required queries found the expected anchors, including `releaseEscrow()`,
`transitionOrder()`, `changePasswordSchema`, `PaymentProvider`,
`drainPendingAuditWrites()`, shared-contract tests, backend mappers, and frontend
consumers. Broad traversal returned 332-722 nodes and surfaced unrelated semantic leads.
For implementation work, queries therefore need exact symbols, explicit `--context`
filters, or `path`/`explain`; unscoped output is too broad.

## Output security review

All persistent JSON outputs parse successfully. A pinned Gitleaks 8.30.1 directory scan
reported five generic-key findings, all confirmed as Graphify's 64-character cache
digests whose path names contain words such as `auth`, `key`, or `secret`; no
credential value was found. High-confidence token, private-key, JWT, and credentialed-URL
patterns returned no matches.

`graph.json`, `graph.html`, `manifest.json`, and `cost.json` contain no
machine-specific user path. The report header was regenerated with the project label
instead of an absolute path. The local `.graphify_root` and `.graphify_python` markers
necessarily retain machine paths, remain ignored, and must not be published.

## Limitations and next gate

- The graph covers code, SQL, Markdown/YAML documentation, and the seven tracked SVG
  images. Generated static assets remain excluded.
- `EXTRACTED` edges are navigation evidence and must still be verified in source.
- Host-agent semantic extraction is materially slower than AST extraction on the first
  uncached run, and exact token telemetry was not exposed by the worker interface.
- Broad natural-language traversal currently produces false-positive leads; use scoped
  queries and verify every material path in source.
- The graph does not replace tests, migrations, CI, runtime traces, authorization review,
  or financial invariant checks.
- The built-in 9.3x token-reduction benchmark is only a tool estimate. The planned
  repository-specific A/B evaluation remains a separate later gate.
- Do not commit generated graph output until the planned A/B evaluation demonstrates a
  measurable navigation benefit without unacceptable Git noise.
