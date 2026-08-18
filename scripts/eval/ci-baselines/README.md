# CI baselines

Committed regression baselines for the evaluation system. The CI eval runners
(see `../../.github/workflows/eval-smoke.yml` and `eval-nightly.yml` — or
`../../docs/EVALUATION-CI.md` for the strategy) compare fresh runs against
these files instead of a machine-local userData path, so gates are
reproducible on clean runners.

## Format

One JSON file per dataset version, named `<datasetVersion>.json`:

```json
{
  "datasetVersion": "folio-agent-v1",
  "gitSha": "abc123…",
  "createdAt": "2026-08-18T03:17:00Z",
  "metrics": {
    "task_completion": 0.91,
    "tool_accuracy": 0.88,
    "groundedness": 0.94,
    "failure_recovery": 0.79
  },
  "thresholds": {
    "task_completion": 0.02,
    "tool_accuracy": 0.02,
    "groundedness": 0.02,
    "failure_recovery": 0.05
  }
}
```

| Field | Meaning |
|---|---|
| `datasetVersion` | Dataset identifier this baseline was computed against (dataset changes require a version bump, so baselines stay comparable). |
| `gitSha` | Commit the baseline was produced from. |
| `createdAt` | ISO-8601 timestamp of the baseline run. |
| `metrics` | `{ metricId: score }` — the measured mean scores over the dataset. |
| `thresholds` | `{ metricId: maxDelta }` — max allowed absolute regression of a metric below its baseline before the gate fails. |

`maxDelta` is always an absolute difference (e.g. `0.91` → `0.89` with
`maxDelta: 0.02` fails the gate). Small-sample results are reported with
sample counts; sub-threshold deltas are never treated as meaningful.

## Current baselines

- `folio-agent-v1.json` — **placeholder**. `metrics` and `thresholds` are
  intentionally empty; the lead seeds real values from the first smoke
  baseline run. Do not fabricate numbers.

## Promoting a baseline (updating expectations)

1. Run the full benchmark locally and save the resulting baseline:
   `bun run eval:full -- --mode live --judge-provider anthropic --save-baseline <name>`
   (run `bun run eval:full -- --help` for exact flags; `--save-baseline`
   writes the JSON to the local userData-style baselines path).
2. Copy that JSON into this directory as `<datasetVersion>.json`.
3. Review the thresholds before committing — `maxDelta` should be tight
   enough to catch real regressions and loose enough to absorb evaluator
   noise on the dataset sample size.
4. Commit with a message describing why the expectation changed (e.g.
   `chore(eval): refresh folio-agent-v1 baseline after dataset v1.1`).