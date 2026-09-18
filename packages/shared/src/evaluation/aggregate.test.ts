// Verdict classification + aggregation (spec §69, §75-78, §111).
//
// This module carried no test file, which is exactly how a failure mode missing
// from the classification table fell through to `pass` unnoticed: the table was
// two hand-maintained `Set`s and nothing asserted they covered the union.
import { describe, expect, it } from 'bun:test';
import type {
  EvaluationBaseline,
  EvaluationCase,
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

function makeCase(id: string): EvaluationCase {
  return {
    id,
    name: id,
    category: 'market',
    difficulty: 'golden',
    input: { prompt: `Prompt for ${id}` },
    expected: {},
    tags: [],
    source: 'hand-authored',
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
  const cases: EvaluationCase[] = [];

  it('excludes not-applicable runs from the pass rate denominator', () => {
    const runs = [
      makeRun({ id: 'run-1' }),
      makeRun({ id: 'run-2' }),
      makeRun({ id: 'run-3', failureModes: ['judge_error'] }),
    ];
    const results = [
      makeResult([makeScore('task_completion', 1)], { id: 'result-1', runId: 'run-1', verdict: 'pass' }),
      makeResult([makeScore('task_completion', 0)], { id: 'result-2', runId: 'run-2', verdict: 'fail' }),
      makeResult([], { id: 'result-3', runId: 'run-3', verdict: 'not-applicable', failureModes: ['judge_error'] }),
    ];
    const summary = summarizeExperiment(runs, results, [
      makeCase('case-1'),
      makeCase('case-2'),
      makeCase('case-3'),
    ]);
    expect(summary.passRate).toBe(0.5);
    expect(summary.completedRuns).toBe(3);
    expect(summary.totalRuns).toBe(3);
    // A judge that produced no scores is a measurement gap, not a pass.
    expect(summary.validity).toBe('inconclusive');
    expect(summary.validityReasons).toContain('judge_error');
  });

  it('counts a judge-only run out of the pass rate but still records judge_error', () => {
    const judgeRun = makeRun({ id: 'run-3', failureModes: ['judge_error'] });
    const runs = [makeRun({ id: 'run-1' }), makeRun({ id: 'run-2' }), judgeRun];
    const results = [
      makeResult([], { id: 'result-1', runId: 'run-1', verdict: 'pass' }),
      makeResult([], { id: 'result-2', runId: 'run-2', verdict: 'fail' }),
      makeResult([], {
        id: 'result-3',
        runId: 'run-3',
        failureModes: judgeRun.failureModes,
        verdict: verdictForRun(judgeRun),
      }),
    ];
    const summary = summarizeExperiment(runs, results, cases);
    expect(summary.passRate).toBe(0.5);
    expect(summary.failureModes).toContainEqual({
      mode: 'judge_error',
      count: 1,
      sampleCount: 3,
    });
  });

  it('reports a null pass rate and inconclusive validity when nothing was applicable', () => {
    const runs = [makeRun({ id: 'run-1' })];
    const results = [makeResult([], { id: 'result-1', runId: 'run-1', verdict: 'not-applicable' })];
    const summary = summarizeExperiment(runs, results, cases);
    expect(summary.passRate).toBeNull();
    expect(summary.validity).toBe('inconclusive');
    expect(summary.validityReasons).toContain('no_applicable_runs');
  });

  it('is invalid with no headline score when every run failed at infrastructure level', () => {
    // Regression for the nightly incident (issue #113): 0 measured cases must
    // never read as a comparable composite score or a valid benchmark. A
    // generic `PI_RUNTIME_ERROR` that never started is still infrastructure —
    // it must not masquerade as an agent-quality result.
    const runs = [
      makeRun({
        id: 'run-1',
        status: 'failed',
        execution: 'not-started',
        error: { code: 'PI_RUNTIME_ERROR', message: 'no key' },
      }),
      makeRun({
        id: 'run-2',
        status: 'failed',
        execution: 'not-started',
        error: { code: 'PI_HEALTH_TIMEOUT', message: 'timeout' },
      }),
    ];
    const results = [
      makeResult([makeScore('task_completion', 0)], {
        id: 'result-1',
        runId: 'run-1',
        verdict: 'fail',
        failureModes: ['runtime_error'],
      }),
      makeResult([makeScore('task_completion', 0)], {
        id: 'result-2',
        runId: 'run-2',
        verdict: 'fail',
        failureModes: ['runtime_error'],
      }),
    ];
    const summary = summarizeExperiment(runs, results, []);
    expect(summary.validity).toBe('invalid');
    expect(summary.compositeScore).toBeNull();
    expect(summary.passRate).toBeNull();
    expect(summary.execution).toEqual({
      requested: 0,
      started: 0,
      evaluated: 0,
      infraFailed: 2,
      skipped: 0,
    });
    expect(summary.validityReasons).toEqual(['PI_RUNTIME_ERROR', 'PI_HEALTH_TIMEOUT']);
    // Diagnostics survive: the failure modes are still counted.
    expect(summary.failureModes.length).toBeGreaterThan(0);
  });

  it('is inconclusive on partial infrastructure failure and keeps valid-run quality', () => {
    const runs = [
      makeRun({ id: 'run-1' }),
      makeRun({ id: 'run-2', status: 'failed', error: { code: 'PI_RUNTIME_EXITED', message: 'exited' } }),
      makeRun({ id: 'run-3', status: 'failed', error: { code: 'PI_RUNTIME_ERROR', message: 'no key' } }),
    ];
    const results = [
      makeResult([makeScore('task_completion', 1)], { id: 'result-1', runId: 'run-1', verdict: 'pass' }),
      makeResult([], { id: 'result-2', runId: 'run-2', verdict: 'fail' }),
      makeResult([], { id: 'result-3', runId: 'run-3', verdict: 'fail' }),
    ];
    const summary = summarizeExperiment(runs, results, cases);
    expect(summary.validity).toBe('inconclusive');
    // run-2 is explicit infra (process exited); run-3 started and failed with
    // the catch-all runtime error, so it stays a quality failure.
    expect(summary.passRate).toBe(0.5); // 1 pass out of 2 quality, applicable runs
    expect(summary.compositeScore).toBe(1); // quality failures contribute no scores
    expect(summary.execution.infraFailed).toBe(1);
    expect(summary.execution.evaluated).toBe(2);
    expect(summary.validityReasons).toContain('PI_RUNTIME_EXITED');
    expect(summary.validityReasons).not.toContain('PI_RUNTIME_ERROR');
    expect(summary.metricAggregates).toContainEqual({
      metric: 'task_completion',
      score: 1,
      sampleCount: 1,
    });
  });

  it('counts a run that started and then timed out as a negative quality result', () => {
    // The wall-clock budget is a task-level outcome: the agent had its chance
    // and failed to deliver. Only "never started" or an explicit runtime
    // process failure is infrastructure (#113 review).
    const runs = [
      makeRun({ id: 'run-1' }),
      makeRun({
        id: 'run-2',
        status: 'timeout',
        failureModes: ['timeout'],
        error: { code: 'PI_REQUEST_TIMEOUT', message: 'Pi request timed out after 120000ms.' },
      }),
    ];
    const results = [
      makeResult([makeScore('task_completion', 1)], { id: 'result-1', runId: 'run-1', verdict: 'pass' }),
      makeResult([], {
        id: 'result-2',
        runId: 'run-2',
        verdict: 'fail',
        failureModes: ['timeout'],
      }),
    ];
    const summary = summarizeExperiment(runs, results, [makeCase('case-1'), makeCase('case-2')]);
    expect(summary.validity).toBe('valid');
    expect(summary.passRate).toBe(0.5);
    expect(summary.execution).toEqual({
      requested: 2,
      started: 2,
      evaluated: 2,
      infraFailed: 0,
      skipped: 0,
    });
    expect(summary.validityReasons).toEqual([]);
  });

  it('counts a started tool-loop / budget failure as a negative quality result', () => {
    const runs = [
      makeRun({
        id: 'run-1',
        status: 'failed',
        failureModes: ['tool_loop'],
        error: { code: 'LOOP_DETECTED', message: 'Run stopped: loop_detected.' },
      }),
      makeRun({
        id: 'run-2',
        status: 'failed',
        failureModes: ['tool_loop'],
        error: { code: 'BUDGET_EXHAUSTED', message: 'Run stopped: budget_exhausted.' },
      }),
    ];
    const results = [
      makeResult([], { id: 'result-1', runId: 'run-1', verdict: 'fail', failureModes: ['tool_loop'] }),
      makeResult([], { id: 'result-2', runId: 'run-2', verdict: 'fail', failureModes: ['tool_loop'] }),
    ];
    const summary = summarizeExperiment(runs, results, [makeCase('case-1'), makeCase('case-2')]);
    expect(summary.validity).toBe('valid');
    expect(summary.passRate).toBe(0);
    expect(summary.execution.infraFailed).toBe(0);
    expect(summary.execution.evaluated).toBe(2);
    expect(summary.failureModes).toContainEqual({ mode: 'tool_loop', count: 2, sampleCount: 2 });
  });

  it('keeps a completed negative case valid and failed', () => {
    const runs = [makeRun({ id: 'run-1', failureModes: ['missing_tool'] })];
    const results = [
      makeResult([makeScore('task_completion', 0)], { id: 'result-1', runId: 'run-1', verdict: 'fail' }),
    ];
    const summary = summarizeExperiment(runs, results, [makeCase('case-1')]);
    expect(summary.validity).toBe('valid');
    expect(summary.passRate).toBe(0);
    expect(summary.compositeScore).toBe(0);
    expect(summary.execution).toEqual({
      requested: 1,
      started: 1,
      evaluated: 1,
      infraFailed: 0,
      skipped: 0,
    });
  });

  it('counts never-started runs as infra failures and unrun cases as skipped', () => {
    const runs = [
      makeRun({ id: 'run-1', status: 'failed', execution: 'not-started', error: { code: 'PI_RUNTIME_NOT_FOUND', message: 'missing' } }),
    ];
    const summary = summarizeExperiment(runs, [], [makeCase('a'), makeCase('b'), makeCase('c')]);
    expect(summary.validity).toBe('invalid');
    expect(summary.execution).toEqual({
      requested: 3,
      started: 0,
      evaluated: 0,
      infraFailed: 1,
      skipped: 2,
    });
    expect(summary.validityReasons).toContain('PI_RUNTIME_NOT_FOUND');
    // Unrun cases appear as skipped, not as a separate 'not_run' reason.
    expect(summary.validityReasons).toContain('skipped');
  });

  it('is invalid when every case was skipped — all-skipped can never earn a green light', () => {
    const runs = [makeRun({ id: 'run-1', status: 'skipped' }), makeRun({ id: 'run-2', status: 'skipped' })];
    const summary = summarizeExperiment(runs, [], [makeCase('a'), makeCase('b')]);
    expect(summary.validity).toBe('invalid');
    expect(summary.compositeScore).toBeNull();
    expect(summary.passRate).toBeNull();
    expect(summary.execution).toEqual({
      requested: 2,
      started: 2,
      evaluated: 0,
      infraFailed: 0,
      skipped: 2,
    });
    expect(summary.validityReasons).toContain('skipped');
  });
});

describe('compareToBaseline / gatePassed (spec §76-77)', () => {
  const baseline = makeBaseline({
    metrics: makeBaselineMetrics({ task_completion: 1 }),
    thresholds: { task_completion: 0.05 },
  });

  function summaryWith(score: number) {
    const runs = [makeRun({ id: 'run-1' })];
    const results = [makeResult([makeScore('task_completion', score)], { id: 'result-1', runId: 'run-1' })];
    return summarizeExperiment(runs, results, []);
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
