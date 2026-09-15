// Aggregation: verdicts, experiment summaries, failure counts, and regression
// comparison (spec §69, §75-78, §111). Composite scores are always shown next
// to their per-metric breakdown — a single number must never mask a critical
// metric regression (§111).
import type {
  EvaluationBaseline,
  EvaluationCase,
  EvaluationExperiment,
  EvaluationFailureMode,
  EvaluationMetricId,
  EvaluationResultRecord,
  EvaluationRun,
  EvaluationScore,
  ExperimentSummary,
  FailureModeCount,
  MetricAggregate,
  RegressionResult,
} from '@finagent/core';
import { EVALUATION_METRICS } from '@finagent/core';

type FailureModeDisposition = 'fail' | 'partial' | 'not-applicable';

/**
 * Severity of every failure mode. Declared as an exhaustive `Record` over
 * `EvaluationFailureMode` on purpose: adding a mode to that union without
 * classifying it here is a **compile error**. Two hand-maintained `Set`s could
 * drift from the union silently, and an unclassified mode fell through to
 * `pass` — inflating the pass rate of an experiment that had actually failed.
 *
 * `judge_error` is an evaluation-infrastructure outcome, not an agent failure
 * (see `evaluators/deterministic.ts`). A run with only `judge_error` is excluded
 * from the pass rate, while any real agent failure on the same run still wins.
 */
const MODE_DISPOSITION: Record<EvaluationFailureMode, FailureModeDisposition> = {
  // Critical: the run itself was wrong.
  wrong_tool: 'fail',
  missing_tool: 'fail',
  wrong_args: 'fail',
  no_evidence: 'fail',
  unsupported_claim: 'fail',
  premature_answer: 'fail',
  tool_loop: 'fail',
  timeout: 'fail',
  runtime_error: 'fail',
  // Degraded: the run answered, but something upstream was off.
  provider_failure: 'partial',
  duplicate_tool: 'partial',
  ignored_tool_result: 'partial',
  context_miss: 'partial',
  strategy_miss: 'partial',
  resource_unavailable: 'partial',
  // Infrastructure: count the judge failure, but exclude a judge-only run.
  judge_error: 'not-applicable',
};

/** Verdict per case (spec §69): fail on critical modes, partial otherwise. */
export function verdictForRun(run: EvaluationRun): EvaluationResultRecord['verdict'] {
  if (run.status === 'skipped') return 'not-applicable';
  if (run.status !== 'completed') return 'fail';
  let worst: 'pass' | 'partial' = 'pass';
  let hasJudgeError = false;
  for (const mode of run.failureModes) {
    const disposition: FailureModeDisposition | undefined = MODE_DISPOSITION[mode];
    // A mode absent from the table is either a mode added to the union without
    // classification (a compile error, so unreachable) or a record written by a
    // different version. Neither may be silently treated as a pass.
    if (disposition === undefined || disposition === 'fail') return 'fail';
    if (disposition === 'partial') worst = 'partial';
    if (disposition === 'not-applicable') hasJudgeError = true;
  }
  return worst === 'pass' && hasJudgeError ? 'not-applicable' : worst;
}

export function aggregateScores(
  results: EvaluationResultRecord[],
  metrics: readonly EvaluationMetricId[],
): MetricAggregate[] {
  return metrics.map((metric) => {
    const values = results
      .map((result) => result.scores.find((score) => score.metric === metric)?.score)
      .filter((value): value is number => typeof value === 'number');
    const score = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
    return { metric, score, sampleCount: values.length };
  });
}

export function countFailureModes(results: EvaluationResultRecord[]): FailureModeCount[] {
  const counts = new Map<EvaluationFailureMode, number>();
  for (const result of results) {
    for (const mode of new Set(result.failureModes)) {
      counts.set(mode, (counts.get(mode) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([mode, count]) => ({ mode, count, sampleCount: results.length }))
    .sort((a, b) => b.count - a.count);
}

/** Composite = mean of all measurable (non-null) scores. Always paired with the
 *  per-metric breakdown by callers (§111). */
export function compositeScore(results: EvaluationResultRecord[]): number | null {
  const values: number[] = [];
  for (const result of results) {
    for (const score of result.scores) {
      if (typeof score.score === 'number') values.push(score.score);
    }
  }
  return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

export function summarizeExperiment(
  experiment: EvaluationExperiment,
  results: EvaluationResultRecord[],
  cases: EvaluationCase[],
): ExperimentSummary {
  const verdicts = results.map((result) => result.verdict);
  const passed = verdicts.filter((v) => v === 'pass').length;
  const applicable = verdicts.filter((v) => v !== 'not-applicable').length;
  const metrics = EVALUATION_METRICS.map((m) => m.id).filter((id) =>
    results.some((result) => result.scores.some((score) => score.metric === id))
  );
  return {
    passRate: applicable > 0 ? passed / applicable : 0,
    compositeScore: compositeScore(results),
    metricAggregates: aggregateScores(results, metrics),
    failureModes: countFailureModes(results),
    totalRuns: experiment.runIds.length,
    completedRuns: results.length,
  };
}

export interface MetricBaselineEntry {
  metric: EvaluationMetricId;
  baseline: number | null;
  current: number | null;
  threshold: number;
  critical: boolean;
}

export function summarizeMetricsForComparison(
  results: EvaluationResultRecord[],
): Record<EvaluationMetricId, number> {
  const metrics = EVALUATION_METRICS.map((m) => m.id);
  const out = {} as Record<EvaluationMetricId, number>;
  for (const aggregate of aggregateScores(results, metrics)) {
    if (aggregate.score !== null) out[aggregate.metric] = aggregate.score;
  }
  return out;
}

/** Regression gate (spec §76-77): critical metrics must not regress past maxDelta. */
export function compareToBaseline(
  summary: ExperimentSummary,
  baseline: EvaluationBaseline | undefined,
): RegressionResult[] {
  const metricById = new Map(EVALUATION_METRICS.map((m) => [m.id, m]));
  return summary.metricAggregates.map((aggregate) => {
    const definition = metricById.get(aggregate.metric);
    // `baseline` arrives from two places. A committed `scripts/eval/ci-baselines`
    // JSON is normalised by `loadCommittedBaseline` (it returns undefined unless
    // `metrics` is an object and defaults `thresholds` to `{}`). A store-backed
    // baseline is not: `EvaluationStore.load()` only checks that `baselines` is an
    // array, and validates no entry shape — unlike `settings`, which goes through
    // `sanitizeSettings`. An entry persisted by another version can therefore
    // reach here without `metrics`/`thresholds`; degrade, do not throw.
    const baselineValue = baseline?.metrics?.[aggregate.metric] ?? null;
    const currentValue = aggregate.score;
    const delta = baselineValue !== null && currentValue !== null ? currentValue - baselineValue : null;
    const maxDelta = baseline?.thresholds?.[aggregate.metric] ?? definition?.defaultMaxDelta ?? 0.05;
    const critical = definition?.critical ?? false;
    const passed =
      delta === null || baselineValue === null || currentValue === null
        ? true
        : delta >= -maxDelta;
    return {
      metric: aggregate.metric,
      baseline: baselineValue,
      current: currentValue,
      delta,
      maxDelta,
      critical,
      passed,
    };
  });
}

export function gatePassed(regressions: RegressionResult[]): boolean {
  return regressions.filter((r) => r.critical).every((r) => r.passed);
}
