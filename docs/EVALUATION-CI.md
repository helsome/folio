# Evaluation CI (V7)

How the evaluation system is gated in CI. Architecture and metric semantics
live in [EVALUATION.md](EVALUATION.md); this page is the CI strategy, the
workflows, and how to promote baselines.

## Strategy at a glance

| Trigger | Workflow | What runs | Cost | Gate? |
|---|---|---|---|---|
| Every PR + push to `main` | `eval-smoke.yml` | `eval:smoke` — fixture mode, deterministic evaluators, ~15 high-value regression/golden cases | $0, no LLM calls, no network | **Yes** — blocks merge on regression |
| Nightly 03:17 UTC + manual dispatch | `eval-nightly.yml` | `eval:full` — entire benchmark, live providers, LLM judge | API credits | No — report artifact only |
| Release experiments (manual) | run `eval:full` / targeted experiments locally or via `eval-nightly.yml` dispatch | model/strategy comparisons | API credits | No |

Expensive cloud/live eval **never** runs on every commit (spec §73, §79);
the PR gate is fixture-only by design.

## Why fixture-only on PR (spec §74)

- **Determinism.** Fixture cases evaluate against canned inputs and expected
  outputs; the same commit produces the same scores. No market-data flakiness
  — a live-format eval can fail on bad tick data or a provider hiccup with
  zero signal about the change under test.
- **Zero cost.** No API spend per commit. Live evals burn credits on every
  push; fixture evals are free and fast (minutes).
- **Speed.** The gate stays under ~minutes so it does not slow the loop.
- **Security.** The smoke workflow runs on PRs from forks with no secrets in
  scope — safe by construction because fixture mode has no credentialed
  dependencies.

Live/cloud evals are still run — just on the nightly cadence or manually,
where cost and flakiness are acceptable and the results feed the metrics
dashboard and baseline promotion.

## Workflows

### `.github/workflows/eval-smoke.yml` — PR gate

- Triggers: `pull_request`, `push` to `main`.
- Steps: checkout → setup Bun (`oven-sh/setup-bun@v2`) → `bun install
  --frozen-lockfile` → `bun run eval:smoke -- --mode fixture --out
  artifacts/eval-smoke.json` → upload the JSON artifact.
- The CLI exits `0` on pass and `1` on gate failure (metric regression past
  `maxDelta`) or run error; a non-zero exit fails the job and blocks the PR.
- `concurrency` group cancels superseded runs on the same PR/branch.

### `.github/workflows/eval-nightly.yml` — nightly + manual full eval

- Triggers: `schedule` (daily `17 3 * * *` UTC) and `workflow_dispatch`
  (for release/manual experiments).
- Steps: checkout → setup Bun → install → `bun run eval:full -- --mode live
  --judge-provider anthropic --out artifacts/eval-full.json`, with
  `LANGSMITH_PI_API_KEY`, `ANTHROPIC_API_KEY`, and `FINAGENT_JUDGE_API_KEY`
  passed through from repo secrets (never echoed, never logged).
- `continue-on-error` on the eval step: a regression is a signal to review,
  not a page. The run is still reported.
- Report steps (no issue automation): a summary step greps the printed
  summary table into `$GITHUB_STEP_SUMMARY`, and the JSON artifact plus run
  log are uploaded.

## Baselines & promotion

Baseline JSON (dataset version, metrics, per-metric `maxDelta` thresholds) is
seeded from committed files in `scripts/eval/ci-baselines/`
(see `scripts/eval/ci-baselines/README.md` for the format). `folio-agent-v1`
is currently a placeholder with empty metrics; the lead seeds real values
from the first smoke baseline run.

To promote a new/updated baseline:

1. Run the full benchmark locally:
   `bun run eval:full -- --mode live --judge-provider anthropic --save-baseline <name>`
   (see the CLI `--help` for exact flags).
2. Copy the saved JSON into `scripts/eval/ci-baselines/<datasetVersion>.json`.
3. Review `thresholds` before committing: tight enough to catch real
   regressions, loose enough for evaluator noise at the dataset sample size.
4. Commit with a message explaining why expectations changed (dataset bump,
   evaluator fix, new regression cases, …).

## Cost guardrails

- Fixture PR gate: zero API cost by construction (spec §74).
- Live eval: nightly cadence only, on-demand for experiments — never a
  per-commit trigger (spec §73, §79).
- All live runs cap spend via the CLI's `--max-cases`, sampling, concurrency
  and `--timeout-ms` flags; the nightly workflow relies on sane defaults and
  reviewers should keep them sane when dispatching manually.
- Secrets are passed through env from repo secrets only; the workflows never
  echo them or write them to logs.