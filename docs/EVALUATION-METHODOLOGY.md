# Folio Evaluation Methodology (spec §116)

Why these metrics, how success is defined, why deterministic evaluation comes
first, LLM judge limitations, dataset versioning, regression thresholds and
statistical caveats.

## 1. Success definition

A benchmark case is **pass** when the agent produced a complete answer using
the required tools with valid arguments, no forbidden tools, respected the tool
budget, stayed grounded in evidence, and did not trigger a critical failure
mode. **Partial** covers recoverable failures (provider failure handled
honestly, duplicate calls). **Fail** covers wrong/missing tools, wrong
arguments, fabricated/unfounded claims, premature answers, loops, timeouts and
runtime errors.

The contract is behavioral: `EvaluationExpectations` lists required and
forbidden capabilities, evidence requirements, research dimensions and failure
expectations — not just a golden answer string.

## 2. Why deterministic evaluation first (spec §27, §33)

Deterministic evaluators are cheap, explainable, deterministic, and CI-safe.
Tool selection/argument validity/counts/errors, evidence and provenance
presence, freshness, latency, and recovery behavior are all objectively
measurable from the recorded run and tool call records. LLM judges are
reserved for what only a reader can assess: groundedness of prose claims,
analysis completeness, reasoning quality, decision usefulness.

## 3. LLM judge limitations

- Judges are models; they can be wrong, biased by prompt order, and
  inconsistent across runs. Verdicts are structured (`score`, `reason`,
  `evidence`, `version`) and a parse failure marks `judge_error` instead of
  crashing or silently scoring.
- The judge model must differ from the agent under test (spec §80) and the
  rubric must be versioned (spec §81) — changing the prompt invalidates
  historical comparability.
- Judge scores are used for trends and regressions, not as exact measurements.
  Sample counts are always shown.

## 4. Metrics (v1)

| Metric | Kind | Critical | Rationale |
|---|---|---|---|
| task_completion | deterministic | yes | did the agent finish the task |
| tool_recall | deterministic | yes | required tools used |
| tool_precision | deterministic | yes | unnecessary tool calls penalized |
| tool_error_rate | deterministic | no | provider/tool failures |
| argument_validity | deterministic | yes | right tool, right args |
| max_tool_calls | deterministic | no | budget respect |
| evidence_presence | deterministic | yes | answer backed by evidence |
| provenance_presence | deterministic | no | data origin recorded |
| freshness_compliance | deterministic | no | stale data avoided |
| partial_failure_honesty | deterministic | no | failures disclosed, not faked |
| latency | deterministic | no | runtime cost |
| failure_recovery | deterministic | yes | fallback/retry behavior |
| groundedness | llm-judge | yes | no unsupported/fabricated claims |
| research_completeness | llm-judge | no | required dimensions covered |
| financial_reasoning | llm-judge | no | data → proper analysis |
| decision_usefulness | llm-judge | no | actionable, not just buy/sell |
| trajectory_quality | trajectory | no | sensible tool path |

`latency` and `tool_error_rate` are lower-is-better; everything else
higher-is-better. Composites are displayed alongside per-metric breakdowns —
a single number must never mask a critical-metric regression (spec §111).

## 5. Fixture vs live (spec §44–45)

**Fixture** mode: deterministic market data injected into the local runtime.
Suitable for CI, regression, determinism. **Live** mode: real providers,
freshness, real-world behavior. Never mixed into one score. Fixture is the
default for gates.

## 6. Dataset versioning (spec §25)

`folio-agent-v1` is immutable once experiments reference it. Fixes and new
cases produce `folio-agent-v1.1` (or a new id). Baselines pin
`datasetVersion`; comparisons across versions are not made.

## 7. Regression thresholds (spec §76–78)

Critical metrics (task_completion, tool_recall, tool_precision,
argument_validity, evidence_presence, failure_recovery, groundedness) default
to `maxDelta = 0.05` (5 points); non-critical 0.05–0.1; latency 0.2.
A baseline records `{metrics, thresholds}`; the gate fails when a critical
metric's delta is below `-maxDelta`. Thresholds are per-metric, not an
overall-score rule.

## 8. Statistical honesty

- Sample counts are displayed everywhere; small samples are not over-interpreted.
- No claim of significance from a single pair of aggregate numbers.
- Judge runs may be repeated for variance where useful; `judge_error` runs are
  excluded and counted.
- Association between engineering metrics and investment outcomes may be
  studied once both datasets are large enough — linkage data only, never
  causality (spec §51).