// Verdict classification + aggregation (spec §69, §75-78, §111).
//
// This module carried no test file, which is exactly how a failure mode missing
// from the classification table fell through to `pass` unnoticed: the table was
// two hand-maintained `Set`s and nothing asserted they covered the union.
import { describe, expect, it } from 'bun:test';
import type {
  EvaluationBaseline,
  EvaluationCase,
  EvaluationExperiment,
  EvaluationFailureMode,
  EvaluationMetricId,
  EvaluationResultRecord,
  EvaluationRun,
  EvaluationScore,
} from '@finagent/core';
import { EVALUATION_METRICS } from '@finagent/core';
import {
  aggregateScores,
  compareToBaseline,
  compositeScore,
  countFailureModes,
  gatePassed,
  summarizeExperiment,
  verdictForRun,
} from './aggregate.ts';

const NOW = 1_700_000_000_000;

function makeRun(overrides: Partial<EvaluationRun> = {}): EvaluationRun {
  return {
    id: 'run-1',
    experimentId: 'exp-1',
    caseId: 'case-1',
    datasetId: 'dataset-1',
    status: 'completed',
    startedAt: NOW,
    completedAt: NOW + 5_000,
    latencyMs: 5_000,
    answer: 'AAPL trades at $190.50.',
    toolCalls: [],
    failureModes: [],
    ...overrides,
  };
}

function makeScore(
  metric: EvaluationMetricId,
  value: number | null,
  reason = 'fixture'
): EvaluationScore {
  return { metric, metricVersion: '1.0.0', score: value, reason };
}

function makeResult(
  scores: EvaluationScore[],
  overrides: Partial<EvaluationResultRecord> = {}
): EvaluationResultRecord {
  return {
    id: 'result-1',
    runId: 'run-1',
    experimentId: 'exp-1',
    caseId: 'case-1',
    scores,
    failureModes: [],
    verdict: 'pass',
    ...overrides,
  };
}

function makeExperiment(overrides: Partial<EvaluationExperiment> = {}): EvaluationExperiment {
  return {
    id: 'exp-1',
    name: 'fixture',
    datasetId: 'dataset-1',
    datasetVersion: '1.0.0',
    status: 'completed',
    mode: 'fixture',
    config: { mode: 'fixture' },
    metadata: { timestamp: NOW },
    startedAt: NOW,
    completedAt: NOW + 5_000,
    runIds: ['run-1', 'run-2', 'run-3'],
    resultIds: [],
    ...overrides,
  };
}

/** `EvaluationBaseline.metrics` is keyed by the whole metric union. */
function makeBaselineMetrics(
  overrides: Partial<Record<EvaluationMetricId, number>> = {}
): Record<EvaluationMetricId, number> {
  const metrics = {} as Record<EvaluationMetricId, number>;
  for (const { id } of EVALUATION_METRICS) metrics[id] = overrides[id] ?? 0;
  return metrics;
}

function makeBaseline(overrides: Partial<EvaluationBaseline> = {}): EvaluationBaseline {
  return {
    id: 'baseline-1',
    name: 'fixture',
    datasetId: 'dataset-1',
    datasetVersion: '1.0.0',
    experimentId: 'exp-1',
    gitSha: '0'.repeat(40),
    createdAt: NOW,
    metrics: makeBaselineMetrics(),
    thresholds: {},
    ...overrides,
  };
}

/** The full failure-mode union (spec §69) as a runtime list. */
const ALL_FAILURE_MODES: EvaluationFailureMode[] = [
  'wrong_tool',
  'missing_tool',
  'wrong_args',
  'tool_loop',
  'duplicate_tool',
  'ignored_tool_result',
  'provider_failure',
  'no_evidence',
  'unsupported_claim',
  'premature_answer',
  'context_miss',
  'strategy_miss',
  'timeout',
  'runtime_error',
  'judge_error',
  'resource_unavailable',
];

/** Every mode must resolve to an explicit verdict when it is the only mode. */
const EXPECTED_VERDICT: Record<EvaluationFailureMode, EvaluationResultRecord['verdict']> = {
  wrong_tool: 'fail',
  missing_tool: 'fail',
  wrong_args: 'fail',
  tool_loop: 'fail',
  duplicate_tool: 'partial',
  ignored_tool_result: 'partial',
  provider_failure: 'partial',
  no_evidence: 'fail',
  unsupported_claim: 'fail',
  premature_answer: 'fail',
  context_miss: 'partial',
  strategy_miss: 'partial',
  timeout: 'fail',
  runtime_error: 'fail',
  judge_error: 'not-applicable',
  resource_unavailable: 'partial',
};

describe('verdictForRun (spec §69)', () => {
  it('classifies every failure mode in the union', () => {
    // Guards the drift that let `judge_error` and `resource_unavailable` sit
    // outside both classification sets and silently return `pass`.
    expect(Object.keys(EXPECTED_VERDICT).sort()).toEqual([...ALL_FAILURE_MODES].sort());
    for (const mode of ALL_FAILURE_MODES) {
      expect([mode, verdictForRun(makeRun({ failureModes: [mode] }))]).toEqual([
        mode,
        EXPECTED_VERDICT[mode],
      ]);
    }
  });

  it('is not-applicable for a skipped run, even with failure modes recorded', () => {
    expect(verdictForRun(makeRun({ status: 'skipped', failureModes: ['wrong_tool'] }))).toBe(
      'not-applicable'
    );
  });

  it('fails every non-completed, non-skipped status', () => {
    for (const status of ['failed', 'cancelled', 'timeout'] as const) {
      expect([status, verdictForRun(makeRun({ status }))]).toEqual([status, 'fail']);
    }
  });

  it('passes a completed run with no failure modes', () => {
    expect(verdictForRun(makeRun())).toBe('pass');
  });

  it('excludes a run whose only failure mode is judge_error', () => {
    expect(verdictForRun(makeRun({ failureModes: ['judge_error'] }))).toBe('not-applicable');
  });

  it('lets real agent failures dominate judge_error regardless of order', () => {
    expect(verdictForRun(makeRun({ failureModes: ['judge_error', 'missing_tool'] }))).toBe('fail');
    expect(verdictForRun(makeRun({ failureModes: ['missing_tool', 'judge_error'] }))).toBe('fail');
    expect(verdictForRun(makeRun({ failureModes: ['judge_error', 'context_miss'] }))).toBe('partial');
    expect(verdictForRun(makeRun({ failureModes: ['context_miss', 'judge_error'] }))).toBe('partial');
  });

  it('is partial for a resource_unavailable run', () => {
    expect(verdictForRun(makeRun({ failureModes: ['resource_unavailable'] }))).toBe('partial');
  });

  it('lets fail dominate partial', () => {
    expect(verdictForRun(makeRun({ failureModes: ['context_miss', 'missing_tool'] }))).toBe('fail');
    expect(verdictForRun(makeRun({ failureModes: ['missing_tool', 'context_miss'] }))).toBe('fail');
  });

  it('is partial when only partial modes are present', () => {
    expect(verdictForRun(makeRun({ failureModes: ['strategy_miss', 'duplicate_tool'] }))).toBe(
      'partial'
    );
  });

  it('never treats an unrecognised failure mode as a pass', () => {
    // Records persisted by another version can carry a mode this build does not
    // know; an unknown failure must not read as green.
    const unknown = 'a_mode_from_the_future' as EvaluationFailureMode;
    expect(verdictForRun(makeRun({ failureModes: [unknown] }))).toBe('fail');
    expect(verdictForRun(makeRun({ failureModes: ['judge_error', unknown] }))).toBe('fail');
  });
});

describe('aggregateScores (spec §75)', () => {
  it('averages per metric and reports the contributing sample count', () => {
    const results = [
      makeResult([makeScore('task_completion', 1), makeScore('tool_recall', 0)]),
      makeResult([makeScore('task_completion', 0), makeScore('tool_recall', 0.5)]),
    ];
    expect(aggregateScores(results, ['task_completion', 'tool_recall'])).toEqual([
      { metric: 'task_completion', score: 0.5, sampleCount: 2 },
      { metric: 'tool_recall', score: 0.25, sampleCount: 2 },
    ]);
  });

  it('returns a null score and zero samples for a metric nothing scored', () => {
    const results = [makeResult([makeScore('task_completion', 1)])];
    expect(aggregateScores(results, ['groundedness'])).toEqual([
      { metric: 'groundedness', score: null, sampleCount: 0 },
    ]);
  });

  it('excludes null scores from both the mean and the sample count', () => {
    const results = [
      makeResult([makeScore('groundedness', 1)]),
      makeResult([makeScore('groundedness', null)]),
    ];
    expect(aggregateScores(results, ['groundedness'])).toEqual([
      { metric: 'groundedness', score: 1, sampleCount: 1 },
    ]);
  });
});

describe('countFailureModes', () => {
  it('counts each mode once per result and sorts by count', () => {
    const results = [
      makeResult([], { failureModes: ['missing_tool', 'missing_tool', 'context_miss'] }),
      makeResult([], { failureModes: ['missing_tool'] }),
    ];
    expect(countFailureModes(results)).toEqual([
      { mode: 'missing_tool', count: 2, sampleCount: 2 },
      { mode: 'context_miss', count: 1, sampleCount: 2 },
    ]);
  });
});

describe('compositeScore (spec §111)', () => {
  it('is the mean of every measurable score across results', () => {
    const results = [
      makeResult([makeScore('task_completion', 1), makeScore('tool_recall', 0.5)]),
      makeResult([makeScore('task_completion', 0)]),
    ];
    expect(compositeScore(results)).toBeCloseTo(0.5, 10);
  });

  it('is null when nothing measurable was scored', () => {
    expect(compositeScore([makeResult([makeScore('groundedness', null)])])).toBeNull();
  });
});

describe('summarizeExperiment', () => {
  const experiment = makeExperiment();
  const cases: EvaluationCase[] = [];

  it('excludes not-applicable runs from the pass rate denominator', () => {
    const results = [
      makeResult([makeScore('task_completion', 1)], { verdict: 'pass' }),
      makeResult([makeScore('task_completion', 0)], { verdict: 'fail' }),
      makeResult([], { verdict: 'not-applicable' }),
    ];
    const summary = summarizeExperiment(experiment, results, cases);
    expect(summary.passRate).toBe(0.5);
    expect(summary.completedRuns).toBe(3);
    expect(summary.totalRuns).toBe(3);
  });

  it('excludes a judge-only run from pass rate but still counts judge_error', () => {
    const judgeRun = makeRun({ failureModes: ['judge_error'] });
    const results = [
      makeResult([], { verdict: 'pass' }),
      makeResult([], { verdict: 'fail' }),
      makeResult([], {
        failureModes: judgeRun.failureModes,
        verdict: verdictForRun(judgeRun),
      }),
    ];
    const summary = summarizeExperiment(experiment, results, cases);
    expect(summary.passRate).toBe(0.5);
    expect(summary.failureModes).toContainEqual({
      mode: 'judge_error',
      count: 1,
      sampleCount: 3,
    });
  });

  it('reports a zero pass rate rather than NaN when every run is not-applicable', () => {
    const summary = summarizeExperiment(experiment, [makeResult([], { verdict: 'not-applicable' })], cases);
    expect(summary.passRate).toBe(0);
  });
});

describe('compareToBaseline / gatePassed (spec §76-77)', () => {
  const baseline = makeBaseline({
    metrics: makeBaselineMetrics({ task_completion: 1 }),
    thresholds: { task_completion: 0.05 },
  });

  function summaryWith(score: number) {
    const results = [makeResult([makeScore('task_completion', score)])];
    return summarizeExperiment(makeExperiment({ runIds: ['run-1'] }), results, []);
  }

  it('passes a regression within the threshold', () => {
    const [tm] = compareToBaseline(summaryWith(0.96), baseline).filter(
      (r) => r.metric === 'task_completion'
    );
    expect(tm.delta).toBeCloseTo(-0.04, 10);
    expect(tm.maxDelta).toBe(0.05);
    expect(tm.passed).toBe(true);
  });

  it('fails a critical metric regressing past the threshold', () => {
    const regressions = compareToBaseline(summaryWith(0.8), baseline);
    const tm = regressions.find((r) => r.metric === 'task_completion');
    expect(tm?.critical).toBe(true);
    expect(tm?.passed).toBe(false);
    expect(gatePassed(regressions)).toBe(false);
  });

  it('treats a metric with no baseline value as not regressed', () => {
    // A store-backed baseline is a raw JSON entry (`EvaluationStore.load()`
    // validates no per-entry shape), so one persisted by another version can
    // carry neither `metrics` nor `thresholds`. The comparison must degrade to
    // "not regressed" rather than throw on an undefined property access.
    const legacy = { datasetId: 'dataset-1' } as unknown as EvaluationBaseline;
    const regressions = compareToBaseline(summaryWith(1), legacy);
    expect(regressions.every((r) => r.baseline === null && r.passed)).toBe(true);
    expect(gatePassed(regressions)).toBe(true);
  });
});
