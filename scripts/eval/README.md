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