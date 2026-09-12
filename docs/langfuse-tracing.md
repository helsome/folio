# Langfuse tracing for Agent / Deep Research

Folio exports Copilot and Deep Research runs to Langfuse through a single
boundary (`LangfuseEvaluationBackend`). Call sites never import Langfuse event
types. If Langfuse is disabled, misconfigured, or unreachable, the agent path
still completes and a diagnostic is recorded.

## Configuration

| Source | Keys |
| --- | --- |
| Settings → Evaluation | Langfuse tracing toggle, host, public key, secret key (Electron `safeStorage`) |
| Environment | `LANGFUSE_TRACING`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST` |

Default host: `https://cloud.langfuse.com`. Secrets are never written to the
repo, logs, or renderer.

Turn tracing **off** with `LANGFUSE_TRACING=false` even if keys are present.

## Trace / span structure

One Folio run maps to **one Langfuse trace**, not a single LLM generation.

### Copilot (`folio.agent_run`)

- root trace: user input + final answer, tags, metadata
- `tool.<name>` span per tool call (quote, news, …)
- `agent.generation` when model / token usage is known
- `agent.error` on terminal failure

### Deep Research (`folio.deep_research`)

- root trace: symbol / query + report summary
- `research.input`
- `retrieval.<capabilityId>` span per planned capability
- `research.synthesis` generation
- `research.report` span with stance, confidence, evidence counts

## Metadata and tags

Tags (filterable):

- `folio`
- `run_kind:normal` \| `run_kind:evaluation`
- `gold_case:<id>`
- `dataset:<id>@<version>`
- `model:<id>` / `provider:<id>` / `strategy:<id>` / `agent:<version>`

Root metadata always includes `folioRunId` and `runKind`, plus gold case /
dataset / model fields when this is an evaluation run.

## Score schema

Scores are written onto the **same** trace (`score-create`):

| Name | Range | Meaning |
| --- | --- | --- |
| `groundedness` | 0..1 | Evidence-ref coverage or judge groundedness |
| `citation_coverage` | 0..1 | Share of report sections that carry evidence refs |
| `task_completion` | 0..1 | Run completed / partial / failed |
| `tool_retrieval_success` | 0..1 | Successful tools or capabilities |
| `latency_ms` | milliseconds | Wall-clock duration |
| `human` | numeric | Optional reviewer feedback |

Evaluation experiments (`bun run eval:smoke` / `eval:full`) also write
`task_completion` and `groundedness` from the evaluator registry when Langfuse
is the active backend.

## Failure isolation

- Missing keys → `NoopEvaluationBackend` (kind `none`)
- HTTP 5xx / timeout / abort → ingest returns `ok: false`, run continues
- Score writeback failures are swallowed
- Diagnostics: Settings test connection, kernel error log, CLI `eval:langfuse`

## Commands

```sh
bun test packages/shared/src/evaluation/langfuse/langfuse.test.ts
bun run eval:langfuse
```

Regenerate Settings → Evaluation screenshots:

```sh
bun scripts/eval/screenshot-langfuse-settings.ts
```
