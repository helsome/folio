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

const FAILING_MODES: ReadonlySet<EvaluationFailureMode> = new Set([
  'wrong_tool',
  'missing_tool',
  'wrong_args',
  'no_evidence',
  'unsupported_claim',
  'premature_answer',
  'tool_loop',
  'timeout',
  'runtime_error',
]);

const PARTIAL_MODES: ReadonlySet<EvaluationFailureMode> = new Set([
  'provider_failure',
  'duplicate_tool',
  'ignored_tool_result',
  'context_miss',
  'strategy_miss',
]);

/** Verdict per case (spec §69): fail on critical modes, partial otherwise. */
export function verdictForRun(run: EvaluationRun): EvaluationResultRecord['verdict'] {
  if (run.status === 'skipped') return 'not-applicable';
  if (run.status !== 'completed') return 'fail';
  if (run.failureModes.some((mode) => FAILING_MODES.has(mode))) return 'fail';
  if (run.failureModes.some((mode) => PARTIAL_MODES.has(mode))) return 'partial';
  return 'pass';
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
    const baselineValue = baseline?.metrics[aggregate.metric] ?? null;
    const currentValue = aggregate.score;
    const delta = baselineValue !== null && currentValue !== null ? currentValue - baselineValue : null;
    const maxDelta = baseline?.thresholds[aggregate.metric] ?? definition?.defaultMaxDelta ?? 0.05;
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
