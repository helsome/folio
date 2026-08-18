# Evaluation scripts (V7)

Hand-run evaluation/verification tooling for the agent-evaluation domain
(docs/EVALUATION.md). Nothing here runs as part of app startup.

## `trace-smoke.mjs`

Spawns the Pi runtime with the Finagent + LangSmith extensions and sends a
minimal prompt, verifying runtime startup, prompt completion, and (when a
LangSmith key is configured) that a trace run with `metadata.thread_id` equal
to the Pi session id landed in LangSmith.

```sh
bun run scripts/eval/trace-smoke.mjs
```

Exit codes: `0` = pass (or skipped when no LLM credential is present), `1` = fail.

### Dev tracing setup

The repo ships the LangSmith Pi extension wrapper at
`.pi/extensions/langsmith/index.ts` (re-exports
`@langchain/langsmith-pi-extension`); the packaged app ships the bundled copy
built by `bun run build:extension` (apps/electron) to
`extensions/langsmith/index.js`. The wrapper is the default, so `pi install` is
optional — it is only needed for ad-hoc Pi runs outside this repo.

### Env vars

| Variable | Meaning |
|---|---|
| `TRACE_TO_LANGSMITH` | `true`/`1`/`yes`/`on` enables tracing (OFF by default; the smoke script sets it from the key) |
| `LANGSMITH_PI_API_KEY` | LangSmith API key (falls back to `LANGSMITH_API_KEY`) |
| `LANGSMITH_PI_ENDPOINT` | custom/self-hosted API URL (default `https://api.smith.langchain.com`) |
| `LANGSMITH_PI_PROJECT` | project name (default `pi-coding-agent`; the smoke script defaults to `folio-agent`) |
| `LANGSMITH_PI_METADATA` | JSON merged into root trace metadata |

### Local run

```sh
export LANGSMITH_PI_API_KEY=lsv2_…
bun run scripts/eval/trace-smoke.mjs
```

Without an LLM credential (`ANTHROPIC_API_KEY` or any key listed in
`FINAGENT_LLM_ENV_KEYS`) the script prints `skipped: no LLM credential` and
exits 0; without `LANGSMITH_PI_API_KEY` the prompt still runs but the LangSmith
query step is skipped.

## `run.ts` — experiment runner CLI (spec §70-71, §79)

Runs the benchmark experiment through the `ExperimentService` and prints a
per-case table, summary aggregates and (when gated) the regression gate.

```sh
bun run eval:smoke                # regression+golden subset (~15 cases), fixture mode
bun run eval:full                 # entire dataset, fixture mode
bun run eval:smoke -- --mode live --model anthropic/claude-sonnet-4-5
bun run eval:full  -- --baseline <id>
bun run eval:smoke -- --save-baseline release-candidate --out ./eval.json
```

Flags:

| Flag | Meaning |
|---|---|
| `--dataset <id>` | Embedded dataset id (default `folio-agent-v1`) |
| `--mode fixture\|live` | Runtime mode (default `fixture`) |
| `--model <id>` | Agent model under test (e.g. `anthropic/claude-sonnet-4-5`); a `provider/model` value implies the provider |
| `--provider <id>` | Agent provider override |
| `--strategy <id>` | Strategy/skill id loaded into the runtime |
| `--judge-provider <id>` | Judge provider (`anthropic` \| `openai-compatible`) |
| `--judge-model <id>` | Judge model, separate from the agent under test |
| `--judge-api-key <key>` | Judge API key |
| `--max-cases <n>` | Run only the first n cases (deterministic) |
| `--timeout-ms <n>` | Per-run wall-clock budget (default 120000) |
| `--baseline <id>` | Gate the run against a stored baseline |
| `--save-baseline <name>` | Store the run's aggregates as a new baseline |
| `--out <path>` | Write the full JSON artifact to `<path>` |
| `--store <path>` | Eval store dir (default `~/.finagent/eval`) |

**Modes.** `fixture` uses the deterministic local runtime (`LocalRuntimeAdapter`)
with canned per-symbol market data — no LLM credentials, no network, CI-safe
(spec §106). `live` uses the Pi runtime with real providers; credentials come
from env (`ANTHROPIC_API_KEY` or `FINAGENT_PROVIDER_OVERRIDES`).

**Judges.** Configure the judge separately with
`FINAGENT_JUDGE_PROVIDER` / `FINAGENT_JUDGE_MODEL` / `FINAGENT_JUDGE_API_KEY`
(or the `--judge-*` flags). Without a judge the run uses deterministic
evaluators only (a notice is printed).

**Exit codes.** `0` = gate passed (or no baseline configured) with no infra
errors; `1` = gate regression, experiment cancelled, or a runtime error.

**Cost guardrails (spec §79).** Use `--max-cases` for a small first pass and
`--timeout-ms` to bound each run before spending on a full live run.

### Env vars

| Variable | Meaning |
|---|---|
| `FINAGENT_JUDGE_PROVIDER` / `FINAGENT_JUDGE_MODEL` / `FINAGENT_JUDGE_API_KEY` | Judge credentials (CLI); see also `--judge-*` flags |
| `TRACE_TO_LANGSMITH` | `true`/`1` enables LangSmith tracing (live mode) |
| `LANGSMITH_PI_API_KEY` | LangSmith API key (falls back to `LANGSMITH_API_KEY`) |
| `LANGSMITH_PI_PROJECT` / `LANGSMITH_PI_ENDPOINT` | LangSmith project / endpoint overrides |
| `ANTHROPIC_API_KEY` / `FINAGENT_PROVIDER_OVERRIDES` | Live agent provider credentials |
| `FINAGENT_PI_VERSION` | Recorded as `metadata.piVersion` |