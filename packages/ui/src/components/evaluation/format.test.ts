import { describe, expect, it } from 'bun:test';
import type {
  EvaluationBaseline,
  EvaluationExperiment,
  EvaluationMetricId,
  MetricAggregate,
} from '@finagent/core';
import { EVALUATION_METRICS } from '@finagent/core';
import {
  buildModelMetricRows,
  experimentModelLabel,
  failureModeLabel,
  formatDate,
  groupExperimentsByModel,
  metricKindLabel,
  metricLabel,
  regressionFor,
  regressionText,
  scoreDecimal,
  scorePercent,
  shortSha,
} from './format';

function baselineMetrics(base: number): Record<EvaluationMetricId, number> {
  return Object.fromEntries(EVALUATION_METRICS.map((metric) => [metric.id, base])) as Record<
    EvaluationMetricId,
    number
  >;
}

const baseline: EvaluationBaseline = {
  id: 'baseline-1',
  name: 'folio-agent-v1 baseline',
  datasetId: 'folio-agent-v1',
  datasetVersion: '1.0.0',
  experimentId: 'exp-old',
  gitSha: 'abc123d',
  createdAt: 1_600_000_000_000,
  metrics: baselineMetrics(0.8),
  thresholds: {},
};

function aggregate(id: EvaluationMetricId, score: number | null, sampleCount: number): MetricAggregate {
  return { metric: id, score, sampleCount };
}

function experiment(
  id: string,
  overrides: Partial<EvaluationExperiment> = {},
  aggregates: MetricAggregate[] = []
): EvaluationExperiment {
  return {
    id,
    name: `Experiment ${id}`,
    datasetId: 'folio-agent-v1',
    datasetVersion: '1.0.0',
    status: 'completed',
    mode: 'fixture',
    config: { mode: 'fixture', model: 'claude-sonnet-4-5', provider: 'anthropic' },
    metadata: { gitSha: 'abc123def456', timestamp: 1_700_000_000_000 },
    startedAt: 1_700_000_000_000,
    completedAt: 1_700_000_010_000,
    runIds: [],
    resultIds: [],
    summary: {
      passRate: 0.9,
      compositeScore: 0.85,
      metricAggregates: aggregates,
      failureModes: [],
      totalRuns: 10,
      completedRuns: 10,
    },
    ...overrides,
  };
}

describe('labels', () => {
  it('maps metric ids to human names', () => {
    expect(metricLabel('task_completion')).toBe('Task Completion');
    expect(metricLabel('nope')).toBe('nope');
  });

  it('maps metric ids to evaluator kinds', () => {
    expect(metricKindLabel('groundedness')).toBe('llm judge');
    expect(metricKindLabel('task_completion')).toBe('deterministic');
    expect(metricKindLabel('nope')).toBeNull();
  });

  it('maps failure modes to labels, falling back to spaced ids', () => {
    expect(failureModeLabel('wrong_tool')).toBe('Wrong tool');
    expect(failureModeLabel('custom_mode')).toBe('custom mode');
  });
});

describe('score formatting', () => {
  it('renders normalized scores as percent', () => {
    expect(scorePercent(0.876)).toBe('88%');
    expect(scorePercent(0)).toBe('0%');
    expect(scorePercent(null)).toBe('—');
    expect(scorePercent(undefined)).toBe('—');
  });

  it('renders normalized scores as decimals', () => {
    expect(scoreDecimal(0.876)).toBe('0.88');
    expect(scoreDecimal(null)).toBe('—');
  });

  it('renders short shas and dates', () => {
    expect(shortSha('abcdef1234567890')).toBe('abcdef1');
    expect(shortSha(undefined)).toBe('—');
    expect(formatDate(1_700_000_000_000)).toMatch(/^\w{3} \d{1,2}, \d{4}$/);
    expect(formatDate(undefined)).toBe('—');
  });
});

describe('model grouping (spec §67)', () => {
  it('labels an experiment by provider/model', () => {
    expect(experimentModelLabel(experiment('a'))).toBe('anthropic/claude-sonnet-4-5');
    const fixture = experiment('b', { config: { mode: 'fixture' } });
    expect(experimentModelLabel(fixture)).toBe('fixture');
  });

  it('groups completed experiments by model, stable order', () => {
    const a = experiment('a', { config: { mode: 'fixture', model: 'gpt-4o', provider: 'openai' } });
    const b = experiment('b', { config: { mode: 'fixture', model: 'sonnet', provider: 'anthropic' } });
    const c = experiment('c', { config: { mode: 'fixture', model: 'gpt-4o', provider: 'openai' } });
    const running = experiment('r', { status: 'running' });
    const groups = groupExperimentsByModel([a, b, c, running]);
    expect(groups.map((group) => group.label)).toEqual([
      'anthropic/sonnet',
      'openai/gpt-4o',
    ]);
    expect(groups[1].experiments.map((entry) => entry.id)).toEqual(['a', 'c']);
  });

  it('builds rows only for metrics that really have data', () => {
    const a = experiment(
      'a',
      { config: { mode: 'fixture', model: 'gpt-4o', provider: 'openai' } },
      [aggregate('task_completion', 0.9, 5), aggregate('groundedness', 0.8, 3)]
    );
    const b = experiment(
      'b',
      { config: { mode: 'fixture', model: 'sonnet', provider: 'anthropic' } },
      [aggregate('task_completion', 0.7, 4)]
    );
    const rows = buildModelMetricRows(groupExperimentsByModel([a, b]));
    expect(rows.map((row) => row.metricId)).toEqual(['task_completion', 'groundedness']);
    const taskRow = rows[0];
    // Columns are sorted by model label: anthropic/sonnet first, openai/gpt-4o second.
    expect(taskRow.cells.map((cell) => cell?.score)).toEqual([0.7, 0.9]);
    expect(taskRow.cells.map((cell) => cell?.sampleCount)).toEqual([4, 5]);
    expect(rows[1].cells[0]).toBeNull();
    expect(rows[1].cells[1]?.score).toBe(0.8);
  });

  it('averages repeated experiments in the same group (weighted by sample count)', () => {
    const a = experiment(
      'a',
      { config: { mode: 'fixture', model: 'gpt-4o', provider: 'openai' } },
      [aggregate('task_completion', 0.8, 5)]
    );
    const b = experiment(
      'b',
      { config: { mode: 'fixture', model: 'gpt-4o', provider: 'openai' } },
      [aggregate('task_completion', 1.0, 5)]
    );
    const rows = buildModelMetricRows(groupExperimentsByModel([a, b]));
    expect(rows[0].cells[0]?.score).toBeCloseTo(0.9);
    expect(rows[0].cells[0]?.sampleCount).toBe(10);
  });
});

describe('regression (spec §75–78)', () => {
  const customBaseline: EvaluationBaseline = {
    ...baseline,
    metrics: { ...baselineMetrics(0.8), task_completion: 0.8, groundedness: 0.7 },
  };

  it('computes a composite delta against a same-version baseline', () => {
    const exp = experiment(
      'exp-new',
      {},
      [aggregate('task_completion', 0.85, 10), aggregate('groundedness', 0.75, 8)]
    );
    const info = regressionFor(exp, [customBaseline]);
    expect(info).not.toBeNull();
    expect(info?.compositeDelta).toBeCloseTo(0.05);
    expect(info?.comparedMetrics).toBe(2);
    expect(info?.regressed).toEqual([]);
  });

  it('flags metrics regressed beyond their threshold', () => {
    const exp = experiment(
      'exp-new',
      {},
      [aggregate('task_completion', 0.7, 10)] // baseline 0.8 → delta −0.10 > 0.05 max
    );
    const info = regressionFor(exp, [customBaseline]);
    expect(info?.regressed.map((entry) => entry.metricId)).toEqual(['task_completion']);
  });

  it('ignores baselines from a different dataset version', () => {
    const exp = experiment(
      'exp-new',
      { datasetVersion: '1.1.0' },
      [aggregate('task_completion', 0.9, 10)]
    );
    expect(regressionFor(exp, [baseline])).toBeNull();
    expect(regressionText(exp, [baseline])).toBe('—');
  });

  it('renders one-line regression text with regressed-critical count', () => {
    const improved = experiment(
      'exp-new',
      {},
      [aggregate('task_completion', 0.9, 10)] // baseline 0.8 → +0.10
    );
    expect(regressionText(improved, [baseline])).toBe('▲ 0.10');
    const regressed = experiment(
      'exp-new',
      {},
      [aggregate('task_completion', 0.7, 10)] // → −0.10, task_completion is critical
    );
    expect(regressionText(regressed, [baseline])).toBe('▼ 0.10 (1)');
  });
});