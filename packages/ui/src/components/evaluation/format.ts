import type {
  EvaluationBaseline,
  EvaluationExperiment,
  EvaluationMetricId,
} from '@finagent/core';
import { EVALUATION_METRICS } from '@finagent/core';

/**
 * Pure display helpers for the Evaluation Center. Kept free of React so the
 * shape/formatting logic is unit-testable (spec §64–68, §111).
 */

const METRIC_LABELS: Readonly<Record<EvaluationMetricId, string>> = Object.fromEntries(
  EVALUATION_METRICS.map((metric) => [metric.id, metric.name])
) as Record<EvaluationMetricId, string>;

const METRIC_KIND_LABELS: Readonly<Record<string, string>> = {
  deterministic: 'deterministic',
  'llm-judge': 'llm judge',
  trajectory: 'trajectory',
  outcome: 'outcome',
};

export function metricLabel(id: string): string {
  return METRIC_LABELS[id as EvaluationMetricId] ?? id;
}

export function metricKindLabel(id: string): string | null {
  const metric = EVALUATION_METRICS.find((entry) => entry.id === id);
  return metric ? METRIC_KIND_LABELS[metric.kind] ?? metric.kind : null;
}

const FAILURE_MODE_LABELS: Readonly<Record<string, string>> = {
  wrong_tool: 'Wrong tool',
  missing_tool: 'Missing tool',
  wrong_args: 'Wrong arguments',
  tool_loop: 'Tool loop',
  duplicate_tool: 'Duplicate tool call',
  ignored_tool_result: 'Ignored tool result',
  provider_failure: 'Provider failure',
  no_evidence: 'No evidence',
  unsupported_claim: 'Unsupported claim',
  premature_answer: 'Premature answer',
  context_miss: 'Context miss',
  strategy_miss: 'Strategy miss',
  timeout: 'Timeout',
  runtime_error: 'Runtime error',
  judge_error: 'Judge error',
  resource_unavailable: 'Resource unavailable',
};

export function failureModeLabel(mode: string): string {
  return FAILURE_MODE_LABELS[mode] ?? mode.replaceAll('_', ' ');
}

/** Normalized 0..1 → percent; null / undefined → em dash. */
export function scorePercent(score: number | null | undefined): string {
  return typeof score === 'number' && Number.isFinite(score) ? `${Math.round(score * 100)}%` : '—';
}

/** Normalized 0..1 → 0.87; null → em dash. */
export function scoreDecimal(score: number | null | undefined): string {
  return typeof score === 'number' && Number.isFinite(score) ? score.toFixed(2) : '—';
}

export function shortSha(sha: string | undefined): string {
  return sha && sha.length > 7 ? sha.slice(0, 7) : sha || '—';
}

export function formatDate(timestamp: number | undefined): string {
  if (typeof timestamp !== 'number') return '—';
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Label for an experiment's model column, e.g. "anthropic/claude-sonnet-4-5". */
export function experimentModelLabel(experiment: EvaluationExperiment): string {
  const { config } = experiment;
  if (config.model) return config.provider ? `${config.provider}/${config.model}` : config.model;
  return config.provider ?? (experiment.mode === 'fixture' ? 'fixture' : '—');
}

export interface ModelGroup {
  key: string;
  label: string;
  experiments: EvaluationExperiment[];
}

/**
 * Completed experiments grouped by model/provider configuration. Sorted by
 * label so the comparison table has a stable column order (spec §67).
 */
export function groupExperimentsByModel(experiments: EvaluationExperiment[]): ModelGroup[] {
  const groups = new Map<string, ModelGroup>();
  for (const experiment of experiments) {
    if (experiment.status !== 'completed' || !experiment.summary) continue;
    const label = experimentModelLabel(experiment);
    const key = label;
    const existing = groups.get(key);
    if (existing) {
      existing.experiments.push(experiment);
    } else {
      groups.set(key, { key, label, experiments: [experiment] });
    }
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export interface MetricCell {
  /** Average of non-null aggregates across the group's experiments. */
  score: number;
  /** Sum of sample counts behind the average. */
  sampleCount: number;
}

export interface ModelMetricRow {
  metricId: EvaluationMetricId;
  label: string;
  kind: string | null;
  cells: Array<MetricCell | null>;
}

/**
 * Model comparison grid rows. Only metrics that actually have data in at
 * least one group appear — never invented rows (spec §67).
 */
export function buildModelMetricRows(groups: ModelGroup[]): ModelMetricRow[] {
  const seen = new Map<EvaluationMetricId, ModelMetricRow>();
  groups.forEach((group, columnIndex) => {
    for (const experiment of group.experiments) {
      for (const aggregate of experiment.summary?.metricAggregates ?? []) {
        let row = seen.get(aggregate.metric);
        if (!row) {
          row = {
            metricId: aggregate.metric,
            label: metricLabel(aggregate.metric),
            kind: metricKindLabel(aggregate.metric),
            cells: groups.map(() => null),
          };
          seen.set(aggregate.metric, row);
        }
        const current = row.cells[columnIndex];
        if (current) {
          if (aggregate.score === null) continue;
          const combined = {
            score:
              (current.score * current.sampleCount + aggregate.score * aggregate.sampleCount) /
              (current.sampleCount + aggregate.sampleCount),
            sampleCount: current.sampleCount + aggregate.sampleCount,
          };
          row.cells[columnIndex] = combined;
        } else if (aggregate.score !== null) {
          row.cells[columnIndex] = { score: aggregate.score, sampleCount: aggregate.sampleCount };
        }
      }
    }
  });
  const metricOrder = new Map(EVALUATION_METRICS.map((metric, index) => [metric.id, index]));
  return [...seen.values()].sort(
    (a, b) =>
      (metricOrder.get(a.metricId) ?? Number.MAX_SAFE_INTEGER) -
      (metricOrder.get(b.metricId) ?? Number.MAX_SAFE_INTEGER)
  );
}

export interface RegressionInfo {
  /** Signed delta of the composite (mean of shared metric aggregates), 0..1 scale. */
  compositeDelta: number | null;
  /** Metrics that regressed beyond the baseline threshold. */
  regressed: Array<{ metricId: EvaluationMetricId; delta: number }>;
  /** Number of metrics shared between the experiment and the baseline. */
  comparedMetrics: number;
  baselineName: string;
}

/**
 * Regression of an experiment against a baseline pinned to the same dataset
 * version (spec §75–78). Returns null when no comparable baseline exists.
 */
export function regressionFor(
  experiment: EvaluationExperiment,
  baselines: EvaluationBaseline[]
): RegressionInfo | null {
  const summary = experiment.summary;
  if (!summary) return null;
  const comparable = baselines.find(
    (baseline) =>
      baseline.datasetId === experiment.datasetId &&
      baseline.datasetVersion === experiment.datasetVersion
  );
  if (!comparable) return null;

  const deltas: Array<{ metricId: EvaluationMetricId; delta: number }> = [];
  let deltaSum = 0;
  for (const aggregate of summary.metricAggregates) {
    const baselineScore = comparable.metrics[aggregate.metric];
    if (aggregate.score === null || typeof baselineScore !== 'number') continue;
    const delta = aggregate.score - baselineScore;
    deltas.push({ metricId: aggregate.metric, delta });
    deltaSum += delta;
  }
  const regressed = deltas.filter(({ metricId, delta }) => {
    const maxDelta =
      comparable.thresholds[metricId] ??
      EVALUATION_METRICS.find((metric) => metric.id === metricId)?.defaultMaxDelta ??
      0.05;
    return delta < -maxDelta;
  });

  return {
    compositeDelta: deltas.length > 0 ? deltaSum / deltas.length : null,
    regressed,
    comparedMetrics: deltas.length,
    baselineName: comparable.name,
  };
}

/**
 * One-line regression text for table cells, e.g. "▲ +0.02" / "▼ −0.03 (1)" /
 * "—". The parenthesized count is the number of critical-metric regressions.
 */
export function regressionText(experiment: EvaluationExperiment, baselines: EvaluationBaseline[]): string {
  const info = regressionFor(experiment, baselines);
  if (!info || info.compositeDelta === null) return '—';
  const arrow = info.compositeDelta >= 0 ? '▲' : '▼';
  const critical = EVALUATION_METRICS.filter((metric) => metric.critical).map((metric) => metric.id);
  const regressedCritical = info.regressed.filter(({ metricId }) => critical.includes(metricId)).length;
  const deltaText = `${arrow} ${Math.abs(info.compositeDelta).toFixed(2)}`;
  return regressedCritical > 0 ? `${deltaText} (${regressedCritical})` : deltaText;
}
