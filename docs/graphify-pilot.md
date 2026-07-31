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

The direct `graphify .` run detected 480 code files, 41 documents, and 7 images, but
semantic extraction correctly stopped because no external LLM API key was configured.
No credential was added. The first pilot therefore used the deterministic local AST path:

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
| Missing/dangling endpoints | 0 |
| Duplicate/collapsed edges | 0 |

Generated locally:

- `graphify-out/graph.json`
- `graphify-out/GRAPH_REPORT.md`
- `graphify-out/graph.html`

## Limitations and next gate

- The initial graph covers code and SQL structure, not semantic content from Markdown or
  images.
- `EXTRACTED` edges are navigation evidence and must still be verified in source.
- The graph does not replace tests, migrations, CI, runtime traces, authorization review,
  or financial invariant checks.
- Do not commit generated graph output until the planned A/B evaluation demonstrates a
  measurable navigation benefit without unacceptable Git noise.
