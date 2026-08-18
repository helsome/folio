# Folio Evaluation — Agent Engineering Evaluation & LangSmith Observability (V7)

V7 adds the first complete **agent engineering evaluation system** on top of the
existing Research → Outcome → Calibration loop. It answers: what failed, why,
where in the trajectory, which change caused the regression, and which
model/strategy/skill configuration works better.

The two loops are independent but linkable:

```
TRACE → DATASET → EVALUATOR → EXPERIMENT → REGRESSION → IMPROVEMENT
RESEARCH → OUTCOME → CALIBRATION          (existing, preserved)
```

Engineering metrics and investment outcomes can later be studied together
(association only — never causation claims, spec §51).

## 1. Architecture

```
                          Folio Agent Kernel
                                │
                                ▼
                           Pi Runtime
             ┌──────────────────┴──────────────────┐
             ▼                                     ▼
      Folio AgentEvent                     LangSmith Trace
             │                                     │
             │                                     ▼
             │                                 Dataset
             │                                     │
             │                                     ▼
             │                            Evaluators (deterministic + judges)
             │                                     │
             │                                     ▼
             └──────────────┬────────────────── Experiments
                            ▼
                       Evaluation Result
              Engineering / Research / Runtime Quality
```

Layers (spec §3):

1. **Agent Engineering** — tool selection, arguments, trajectory, task
   completion, groundedness, failure recovery, latency, cost, stability.
2. **Financial Research** — completeness, dimensions, evidence coverage,
   freshness, unsupported claims, bull/bear balance, provenance.
3. **Investment Outcome** — existing system untouched (Opinion → Outcome →
   Performance → Calibration); V7 only records linkage data.

## 2. How tracing works

- Pi Runtime spawns with repeated `--extension` flags (verified against Pi CLI
  source: `--extension, -e <path>` **can be used multiple times**).
- Extensions are modeled as `PiExtensionConfig[]`:
  `finagent` (bundled) and `langsmith` (bundled, MIT license).
- The LangSmith extension (`@langchain/langsmith-pi-extension`, npm, MIT) reads
  config from env vars (highest precedence) or `~/.pi/langsmith.json` /
  `<cwd>/.pi/langsmith.json`:

  | Variable | Meaning |
  |---|---|
  | `TRACE_TO_LANGSMITH` | `true`/`1`/`yes`/`on` enables |
  | `LANGSMITH_PI_API_KEY` | API key (falls back to `LANGSMITH_API_KEY`) |
  | `LANGSMITH_PI_ENDPOINT` | custom/self-hosted API URL |
  | `LANGSMITH_PI_PROJECT` | project name (default `pi-coding-agent`) |
  | `LANGSMITH_PI_METADATA` | JSON merged into root trace metadata |
  | `LANGSMITH_PI_RUNS_ENDPOINTS` | replica destinations |

- Folio injects these into the Pi spawn env (main process only; API key comes
  from `safeStorage`, never from renderer/env files). Tracing is **OFF by
  default**; enabling it restarts the Pi process (same as credential changes).
- Each trace root gets `metadata.thread_id` = Pi session id. Because the Pi
  process is persistent, **per-run** metadata (folioRunId, symbol, strategy)
  cannot ride env vars — `TraceCorrelationService` reconstructs the mapping by
  querying LangSmith for traces in the run's window scoped to the thread id,
  and persists `folioRunId ↔ traceId` in the evaluation store (spec §52–55).

## 3. Evaluation domain (packages/core/src/evaluation.ts)

`EvaluationCase` (id, category, difficulty, input, expected behavior),
`EvaluationDataset` (versioned), `EvaluationRun`, `EvaluationResultRecord`,
`EvaluationMetric`/`EvaluationScore`, `EvaluationExperiment` +
`ExperimentSummary`, `EvaluationBaseline` + `RegressionResult`,
`TraceReference`, `EvaluationSettings`, `PrivacyLevel`,
`EvaluationFailureMode` (formal taxonomy — no free-text failure reasons).

## 4. Backends (packages/shared/src/evaluation/backend.ts)

`EvaluationBackend` is the provider-neutral boundary. First implementation:
`LangSmithEvaluationBackend` (minimal REST: `/projects`, `/runs/query`,
`/runs/{id}/feedback`). Plus `LocalEvaluationBackend` and `NoopEvaluationBackend`
for offline mode. **Observability never breaks the agent**: every backend
failure degrades to a status/log entry (spec §87).

## 5. Privacy (Release Blocker — spec §56–60, §105)

- Tracing off by default; production default privacy `standard`; `full` is
  explicit opt-in.
- `minimal`: no prompt/answer/tool payloads — names, status, durations only.
- `standard`: prompt/answer/args allowed after redaction; portfolio tool
  results reduced to schema summaries (never raw holdings/positions/cash/
  account ids/broker metadata).
- `full`: complete trace; credentials/tokens/secrets are still redacted.
- `EvaluationRedactor` enforces redaction locally AND the Finagent Pi extension
  redacts portfolio tool outputs when `FINAGENT_PRIVACY_LEVEL` < `full`, so raw
  portfolio data never enters the Pi conversation (and thus never a trace).
- API key: `safeStorage` via `CredentialStore` (provider `langsmith`); renderer
  can set/delete/query state, never read the raw key. It never appears in
  logs, support bundles, or traces.

## 6. Evaluators (spec §27–41)

Priority: deterministic first, trajectory second, LLM judges last.
Registered per metric with a versioned rubric (judge rubrics must version so
history stays comparable — spec §81).

- Deterministic: task completion, tool coverage (required recall),
  tool precision (penalizes unnecessary calls), argument validity, tool error
  rate, max tool calls, evidence presence, provenance presence, freshness
  compliance, partial-failure honesty, latency, failure recovery.
- Judges (v1, spec §34–38): groundedness, research completeness, financial
  reasoning, decision usefulness. Judge model is configured separately from the
  agent under test (§80). Structured output only; parse failure → `judge_error`
  score null, never crashes the experiment (§107).

## 7. Datasets & benchmark (spec §22–26)

- `folio-agent-benchmark-v1`: 50–100 hand-authored high-quality cases
  (quality > quantity), categories: market, research, tool selection,
  tool arguments, grounded research, strategy/skill, provider failure,
  portfolio, compare, long-tail, adversarial.
- Versioned: `folio-agent-v1` ≠ `folio-agent-v1.1`; changing a case requires a
  version bump so historical experiments stay comparable.
- Difficulty tags: golden, difficult, long_tail, tool_failure, regression,
  adversarial. Fixed real bugs become regression cases (highest gate weight).
- Real user traces may seed cases only after privacy cleanup.

## 8. Experiments (spec §42–45, §79)

`bun run eval:smoke` (10–20 high-value regression/golden cases, PR gate) and
`bun run eval:full` (entire benchmark). Modes: `fixture` (deterministic,
CI-safe) and `live` (real providers). Every experiment records metadata:
gitSha, folio/runtime/Pi versions, model, provider, thinking level, strategy,
skill versions, capability registry version, provider config, timestamps.
Cost control: maxCases, sampling, concurrency, timeout (spec §79).

## 9. Regression gates (spec §75–78)

`EvaluationBaseline` stores dataset version, commit, metrics, thresholds.
Critical metrics (task completion, tool accuracy, groundedness, failure
recovery) cannot regress past `maxDelta` without failing the gate. Small-sample
results are shown with sample counts; 0.91 vs 0.92 is never called a
meaningful improvement.

## 10. CI (spec §72–75)

- PR: `eval:smoke` with fixtures + deterministic evaluators (no market-data
  flakiness).
- Main/nightly (manual): full benchmark.
- Release (manual): model/strategy experiments.
- Expensive cloud eval never runs on every commit.

## 11. UI (spec §61–68)

- Settings → Agent / Evaluation: connection status, tracing toggle, project,
  privacy level, endpoint, test connection, open LangSmith; API key password
  field (configured/updatedAt only).
- Evaluation Center (internal/advanced): benchmark summary, experiment list,
  model comparison (only real metrics), failure-mode view (filterable), case
  detail (prompt, expected/actual, tool timeline, scores, failures, trace
  link), human review (👍/👎 + note).

## 12. Failure taxonomy (spec §40)

`wrong_tool, missing_tool, wrong_args, tool_loop, duplicate_tool,
ignored_tool_result, provider_failure, no_evidence, unsupported_claim,
premature_answer, context_miss, strategy_miss, timeout, runtime_error,
judge_error, resource_unavailable`.

## 13. Outcome linkage (spec §50–51)

EvaluationRun ↔ ResearchReport ↔ ResearchOpinion ↔ ResearchOutcome links are
recorded (no causality claims). Future work: correlate engineering metrics
with realized outcomes.

## 14. Do NOT build (spec §129)

No Agent Runtime rewrite, no Outcome Engine rewrite, no LangSmith clone, no
full trace viewer, no annotation platform, no default upload of production
user data, no auto-online-eval, no auto skill/prompt modification, no
self-modifying production behavior.

## 15. LangSmith setup (developer)

```sh
# In the repo (dev environment only — never part of app startup, spec §9):
pi install npm:@langchain/langsmith-pi-extension
# or rely on the bundled wrapper at .pi/extensions/langsmith/index.ts.

# Configure via electron Settings → Evaluation, or env for the CLI:
export LANGSMITH_PI_API_KEY=lsv2_…   # stored in safeStorage when set via UI
export TRACE_TO_LANGSMITH=true
export LANGSMITH_PI_PROJECT=folio-agent
```