// Experiment runner tests (spec §108-109): fake-kernel driven, zero LLM.
//
// The service must work against a minimal AgentKernel-shaped stub: sessions,
// subscribe + startRun with scripted event streams. Assertions cover
// experiment lifecycle (created/updated), run+result persistence, summary
// aggregation, failure-mode recording, judge inclusion, maxCases sampling,
// abort mid-run, and the regression gate (spec §109: baseline tool accuracy
// 0.95 vs current 0.85 with maxDelta 0.03 must FAIL).
import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  AgentEvent,
  AgentEventPayload,
  ApiError,
  EvaluationBaseline,
  EvaluationCase,
  EvaluationDataset,
  EvaluationMetricId,
  ExperimentConfig,
  Run,
  ToolCall,
  ToolCallRecord,
} from '@finagent/core';
import { LocalEvaluationBackend } from './backend.ts';
import { TraceCorrelationService } from './correlation.ts';
import { ExperimentService, type ExperimentKernel } from './experiment-service.ts';
import { createJudgeClient, type JudgeClient } from './judge-client.ts';
import { EvaluationStore } from './store.ts';
import { JsonFileStore } from '../storage/json-file-store.ts';

// ── Dataset fixtures ────────────────────────────────────────────────────────

const QUOTE_TOOLCALL: ToolCallRecord = {
  id: 'tc-quote',
  toolName: 'get_quote',
  args: { symbol: 'AAPL.US' },
  startedAt: 1000,
  completedAt: 1100,
  status: 'success',
  result: { data: { symbol: 'AAPL.US', lastPrice: 200 }, provenance: { provider: 'longbridge', fetchedAt: 1000 } },
};

const KLINE_ERROR_TOOLCALL: ToolCallRecord = {
  id: 'tc-kline',
  toolName: 'get_kline',
  args: { symbol: 'TSLA.US', period: '1d', limit: 90 },
  startedAt: 2000,
  completedAt: 2100,
  status: 'error',
  error: { code: 'CAPABILITY_UNAVAILABLE', message: 'kline provider unavailable' },
};

function makeCase(id: string, overrides: Partial<EvaluationCase> = {}): EvaluationCase {
  return {
    id,
    name: id,
    category: 'market',
    difficulty: 'golden',
    input: { prompt: `Prompt for ${id}` },
    expected: {},
    tags: [],
    source: 'hand-authored',
    ...overrides,
  };
}

function makeDataset(cases: EvaluationCase[]): EvaluationDataset {
  return {
    id: 'test-dataset',
    version: '1.0.0',
    name: 'Test Dataset',
    createdAt: 0,
    cases,
  };
}

function makeConfig(overrides: Partial<ExperimentConfig> = {}): ExperimentConfig {
  return { mode: 'fixture', ...overrides };
}

// ── Fake kernel ────────────────────────────────────────────────────────────

interface ScriptedRun {
  status: 'completed' | 'failed' | 'cancelled';
  answer?: string;
  toolCalls?: ToolCallRecord[];
  error?: ApiError;
}

class FakeKernel implements ExperimentKernel {
  createdSessions = 0;
  deletedSessions = 0;
  startedRuns = 0;
  private readonly listeners = new Set<(event: AgentEvent) => void>();
  private readonly sessionTitles = new Map<string, string>();
  private readonly scripts = new Map<string, ScriptedRun>();
  private readonly api = { getState: async () => ({ sessionId: 'pi-thread-1' }) };

  script(caseId: string, script: ScriptedRun): void {
    this.scripts.set(caseId, script);
  }

  sessions = {
    createSession: async (title?: string): Promise<{ id: string }> => {
      this.createdSessions += 1;
      const id = `sess-${this.createdSessions}`;
      this.sessionTitles.set(id, title ?? '');
      return { id };
    },
  };

  deleteSession = async (): Promise<void> => {
    this.deletedSessions += 1;
  };

  runs = {
    subscribe: (listener: (event: AgentEvent) => void): (() => void) => {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    },
    startRun: async (sessionId: string, content: string): Promise<Run> => {
      this.startedRuns += 1;
      const runId = `run-${this.startedRuns}`;
      const title = this.sessionTitles.get(sessionId) ?? '';
      const script = this.scripts.get(title) ?? { status: 'completed', answer: 'fallback answer' };
      const now = Date.now();
      const run: Run = { id: runId, sessionId, status: 'running', input: content, startedAt: now };
      let sequence = 0;
      const emit = (type: AgentEvent['type'], payload?: AgentEventPayload): void => {
        sequence += 1;
        const event = { id: crypto.randomUUID(), sessionId, runId, type, timestamp: now, sequence, payload } as AgentEvent;
        for (const listener of this.listeners) listener(event);
      };
      emit('run_started', { run, userMessage: { id: 'msg-user', role: 'user', content, timestamp: now } });
      for (const toolCall of script.toolCalls ?? []) {
        emit('tool_started', { toolCall: toToolCall(toolCall) });
        emit('tool_completed', { toolCall: toToolCall(toolCall) });
      }
      if (script.status === 'completed') {
        const answer = script.answer ?? 'Answer for ' + content;
        emit('message_started');
        emit('message_delta', { delta: answer, answer });
        emit('message_completed', { answer });
        emit('run_completed', { answer, toolCalls: [] });
        run.status = 'completed';
        run.answer = answer;
      } else {
        emit('run_failed', { error: script.error ?? { code: 'RUN_FAILED', message: 'scripted failure' } });
        run.status = script.status;
        run.error = script.error ?? { code: 'RUN_FAILED', message: 'scripted failure' };
      }
      run.completedAt = now;
      return run;
    },
  };

  getLlmApi() {
    return this.api;
  }
}

function toToolCall(record: ToolCallRecord): ToolCall {
  return {
    id: record.id,
    toolName: record.toolName,
    args: record.args,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    status: record.status,
    result: record.result,
    error: record.error,
  };
}

// ── Harness ────────────────────────────────────────────────────────────────

let dir = '';
let store: EvaluationStore;
let backend: LocalEvaluationBackend;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'eval-service-'));
  store = new EvaluationStore(new JsonFileStore(dir));
  backend = new LocalEvaluationBackend();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function createService(kernel: FakeKernel): ExperimentService {
  const correlation = new TraceCorrelationService({ backend, store });
  return new ExperimentService({ store, kernel, backend, correlation });
}

/** Script a healthy quote run for the case id. */
function scriptSuccess(kernel: FakeKernel, caseId: string): void {
  kernel.script(caseId, { status: 'completed', answer: `AAPL is trading at $200.`, toolCalls: [QUOTE_TOOLCALL] });
}

function scoreMap(result: { scores: Array<{ metric: string; score: number | null }> }): Record<string, number | null> {
  return Object.fromEntries(result.scores.map((score) => [score.metric, score.score]));
}

// ── Stalled kernel (#115): a runtime that stops emitting mid-run ───────────

interface StalledScript {
  /** Last answer emitted before the stall (partial evidence). */
  partialAnswer?: string;
  toolCalls?: ToolCallRecord[];
  /** Emit a terminal `run_completed` this many ms after startRun (race tests). */
  lateCompleteMs?: number;
  lateCompleteAnswer?: string;
}

class StalledKernel implements ExperimentKernel {
  startedRuns = 0;
  cancelCalls = 0;
  cancelRequests: Array<{ sessionId: string; runId: string }> = [];
  deletedSessions = 0;
  /** When false, cancellation is requested but the runtime never settles. */
  cancelResponds = true;
  /** When true, cancelRun never resolves (runtime never answers cancellation). */
  hangCancel = false;

  private readonly listeners = new Set<(event: AgentEvent) => void>();
  private readonly sessionCase = new Map<string, string>();
  private readonly scripts = new Map<string, StalledScript>();
  private running = false;
  private activeRunId: string | undefined;
  private activeSessionId: string | undefined;
  private sequence = 0;

  script(caseId: string, script: StalledScript): void {
    this.scripts.set(caseId, script);
  }

  sessions = {
    createSession: async (title?: string): Promise<{ id: string }> => {
      const id = `sess-${this.sessionCase.size + 1}`;
      this.sessionCase.set(id, title ?? '');
      return { id };
    },
  };

  deleteSession = async (): Promise<void> => {
    this.deletedSessions += 1;
  };

  runs = {
    subscribe: (listener: (event: AgentEvent) => void): (() => void) => {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    },
    startRun: async (sessionId: string, content: string): Promise<Run> => {
      this.startedRuns += 1;
      const runId = `run-${this.startedRuns}`;
      const now = Date.now();
      const run: Run = { id: runId, sessionId, status: 'running', input: content, startedAt: now };
      this.running = true;
      this.activeRunId = runId;
      this.activeSessionId = sessionId;
      const emit = (type: AgentEvent['type'], payload?: AgentEventPayload): void => {
        this.sequence += 1;
        const event = {
          id: crypto.randomUUID(),
          sessionId,
          runId,
          type,
          timestamp: now,
          sequence: this.sequence,
          payload,
        } as AgentEvent;
        for (const listener of this.listeners) listener(event);
      };
      emit('run_started', { run, userMessage: { id: 'msg-user', role: 'user', content, timestamp: now } });
      const script = this.scripts.get(this.sessionCase.get(sessionId) ?? '');
      for (const toolCall of script?.toolCalls ?? []) {
        emit('tool_started', { toolCall: toToolCall(toolCall) });
        emit('tool_completed', { toolCall: toToolCall(toolCall) });
      }
      if (script?.partialAnswer !== undefined) {
        emit('message_started');
        emit('message_delta', { delta: script.partialAnswer, answer: script.partialAnswer });
        emit('message_completed', { answer: script.partialAnswer });
      }
      if (script?.lateCompleteMs !== undefined) {
        const answer = script.lateCompleteAnswer ?? 'late completion';
        setTimeout(() => emit('run_completed', { answer, toolCalls: [] }), script.lateCompleteMs);
      }
      // …and then the runtime stalls: no terminal event, isRunning stays true.
      return run;
    },
    isRunning: (): boolean => this.running,
    cancelRun: async (sessionId: string, runId: string): Promise<void> => {
      this.cancelCalls += 1;
      this.cancelRequests.push({ sessionId, runId });
      if (this.hangCancel) return new Promise<void>(() => undefined);
      if (!this.cancelResponds) return;
      this.running = false;
      // Mirror RunManager: a cancelled run settles with a synthesized
      // run_failed RUN_CANCELLED terminal event.
      if (this.activeRunId) {
        this.sequence += 1;
        const event = {
          id: crypto.randomUUID(),
          sessionId: this.activeSessionId,
          runId: this.activeRunId,
          type: 'run_failed' as const,
          timestamp: Date.now(),
          sequence: this.sequence,
          payload: { error: { code: 'RUN_CANCELLED', message: 'Run cancelled by user.' } },
        } as AgentEvent;
        for (const listener of this.listeners) listener(event);
      }
    },
  };

  getLlmApi(): undefined {
    return undefined;
  }
}

function createStalledService(
  kernel: StalledKernel,
  timing: { terminalGraceMs?: number; teardownMs?: number }
): ExperimentService {
  const correlation = new TraceCorrelationService({ backend, store });
  return new ExperimentService({ store, kernel, backend, correlation, timing });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('ExperimentService.runExperiment', () => {
  it('creates + updates the experiment and persists runs and results', async () => {
    const dataset = makeDataset([makeCase('case-ok')]);
    const kernel = new FakeKernel();
    scriptSuccess(kernel, 'case-ok');
    const service = createService(kernel);

    const experiment = await service.runExperiment({ dataset, config: makeConfig() });

    expect(experiment.status).toBe('completed');
    expect(experiment.id).toMatch(/^exp-\d+-[a-f0-9]{6}$/);
    expect(experiment.metadata.gitSha).toBeTypeOf('string');
    expect(experiment.metadata.runtimeVersion).toBe(process.version);
    expect(experiment.metadata.providerConfiguration).toMatchObject({ model: undefined });

    const persisted = await store.getExperiment(experiment.id);
    expect(persisted?.status).toBe('completed');
    expect(persisted?.summary).toBeDefined();
    expect(persisted?.runIds).toHaveLength(1);
    expect(persisted?.resultIds).toHaveLength(1);

    const runs = await store.listRuns(experiment.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('completed');
    expect(runs[0].toolCalls.map((call) => call.toolName)).toEqual(['get_quote']);

    const results = await store.listResults(experiment.id);
    expect(results).toHaveLength(1);
    expect(results[0].verdict).toBe('pass');
    const scores = scoreMap(results[0]);
    expect(scores.task_completion).toBe(1);
    expect(scores.tool_recall).toBe(1);
    expect(scores.evidence_presence).toBe(1);
    expect(scores.groundedness).toBeUndefined(); // no judge configured

    expect(kernel.deletedSessions).toBe(1);
  });

  it('computes summary aggregates (passRate, metricAggregates) and records failure modes', async () => {
    const dataset = makeDataset([
      makeCase('case-pass', { expected: { mustHaveEvidence: true } }),
      makeCase('case-fail'),
      makeCase('case-timeout'),
    ]);
    const kernel = new FakeKernel();
    scriptSuccess(kernel, 'case-pass');
    kernel.script('case-fail', { status: 'failed', error: { code: 'RUNTIME_CRASH', message: 'runtime exited' } });
    kernel.script('case-timeout', {
      status: 'failed',
      error: { code: 'PI_REQUEST_TIMEOUT', message: 'Pi request timed out after 120000ms.' },
    });
    const service = createService(kernel);

    const experiment = await service.runExperiment({ dataset, config: makeConfig() });

    expect(experiment.summary).toMatchObject({
      totalRuns: 3,
      completedRuns: 3,
      passRate: 1 / 3,
    });
    const aggregate = experiment.summary!.metricAggregates.find((entry) => entry.metric === 'task_completion');
    expect(aggregate?.score).toBeCloseTo(1 / 3);
    expect(aggregate?.sampleCount).toBe(3);

    const results = await store.listResults(experiment.id);
    const byCase = Object.fromEntries(results.map((result) => [result.caseId, result]));

    expect(byCase['case-fail'].verdict).toBe('fail');
    expect(byCase['case-fail'].failureModes).toContain('runtime_error');
    expect(byCase['case-timeout'].verdict).toBe('fail');
    expect(byCase['case-timeout'].failureModes).toContain('timeout');

    const runs = await store.listRuns(experiment.id);
    expect(runs.find((run) => run.caseId === 'case-timeout')?.status).toBe('timeout');
    const failureModes = experiment.summary!.failureModes.map((entry) => entry.mode);
    expect(failureModes).toContain('timeout');
    expect(failureModes).toContain('runtime_error');
  });

  it('records a tool failure run with its failure-recovery scores', async () => {
    const dataset = makeDataset([makeCase('case-tool-fail', { expected: { mustHaveEvidence: true } })]);
    const kernel = new FakeKernel();
    kernel.script('case-tool-fail', {
      status: 'completed',
      answer: 'The kline provider was unavailable; I retried with a different endpoint.',
      toolCalls: [KLINE_ERROR_TOOLCALL],
    });
    const service = createService(kernel);

    const experiment = await service.runExperiment({ dataset, config: makeConfig() });

    const results = await store.listResults(experiment.id);
    const scores = scoreMap(results[0]);
    expect(scores.tool_error_rate).toBe(0);
    expect(scores.failure_recovery).toBe(1); // answer discloses the failure
    expect(scores.partial_failure_honesty).toBe(1);
    expect(experiment.summary?.compositeScore).toBeTypeOf('number');
  });

  it('includes LLM judges when a JudgeClient is provided, and skips them otherwise', async () => {
    const dataset = makeDataset([
      makeCase('case-judged', { category: 'research', expected: { requiredResearchDimensions: ['profile'] } }),
    ]);
    const kernel = new FakeKernel();
    scriptSuccess(kernel, 'case-judged');

    let judgedCalls = 0;
    const judge: JudgeClient = {
      provider: 'anthropic',
      model: 'judge-test',
      complete: async () => {
        judgedCalls += 1;
        return JSON.stringify({ score: 0.9, reason: 'grounded in tool evidence', evidence: ['run-0'] });
      },
    };

    const service = createService(kernel);
    const judged = await service.runExperiment({ dataset, config: makeConfig(), judgeClient: judge });

    const judgedResults = await store.listResults(judged.id);
    const judgedScores = scoreMap(judgedResults[0]);
    expect(judgedScores.groundedness).toBe(0.9);
    expect(judgedScores.research_completeness).toBe(0.9);
    expect(judgedCalls).toBeGreaterThan(0);

    // Without a judge client: judge metrics absent from scores, zero LLM calls.
    const kernel2 = new FakeKernel();
    scriptSuccess(kernel2, 'case-judged');
    const service2 = createService(kernel2);
    const before = judgedCalls;
    const exp2 = await service2.runExperiment({ dataset, config: makeConfig() });
    expect(judgedCalls).toBe(before);
    const results2 = await store.listResults(exp2.id);
    const scores2 = scoreMap(results2[0]);
    expect(scores2.groundedness).toBeUndefined();
    expect(scores2.research_completeness).toBeUndefined();
    expect(scores2.task_completion).toBe(1); // deterministic metrics still present
  });

  it('records judge_error failure modes when the judge client throws', async () => {
    const dataset = makeDataset([makeCase('case-judge-error')]);
    const kernel = new FakeKernel();
    scriptSuccess(kernel, 'case-judge-error');
    const judge: JudgeClient = {
      provider: 'anthropic',
      model: 'judge-test',
      complete: async () => {
        throw new Error('judge api down');
      },
    };
    const service = createService(kernel);

    const experiment = await service.runExperiment({ dataset, config: makeConfig(), judgeClient: judge });

    const results = await store.listResults(experiment.id);
    expect(results[0].failureModes).toContain('judge_error');
    const scores = scoreMap(results[0]);
    expect(scores.groundedness).toBeNull();
  });

  it('samples the first N cases when maxCases is set', async () => {
    const dataset = makeDataset([makeCase('c1'), makeCase('c2'), makeCase('c3')]);
    const kernel = new FakeKernel();
    scriptSuccess(kernel, 'c1');
    scriptSuccess(kernel, 'c2');
    scriptSuccess(kernel, 'c3');

    const service = createService(kernel);
    const experiment = await service.runExperiment({ dataset, config: makeConfig({ maxCases: 2 }) });

    expect(experiment.runIds).toHaveLength(2);
    expect(kernel.startedRuns).toBe(2);
    expect((await store.listRuns(experiment.id)).map((run) => run.caseId)).toEqual(['c1', 'c2']);
  });

  it('aborts mid-run: remaining cases skipped and the experiment is cancelled', async () => {
    const dataset = makeDataset([makeCase('a1'), makeCase('a2')]);
    const kernel = new FakeKernel();
    scriptSuccess(kernel, 'a1');
    scriptSuccess(kernel, 'a2');
    const controller = new AbortController();
    const service = createService(kernel);

    const experiment = await service.runExperiment({
      dataset,
      config: makeConfig(),
      signal: controller.signal,
      onProgress: (event) => {
        if (event.kind === 'case_completed' && event.caseId === 'a1') {
          controller.abort();
        }
      },
    });

    expect(experiment.status).toBe('cancelled');
    expect(experiment.runIds).toHaveLength(1);
    expect(kernel.startedRuns).toBe(1);
  });

  it('reports per-case progress events in order', async () => {
    const dataset = makeDataset([makeCase('p1')]);
    const kernel = new FakeKernel();
    scriptSuccess(kernel, 'p1');
    const service = createService(kernel);
    const events: string[] = [];

    await service.runExperiment({
      dataset,
      config: makeConfig(),
      onProgress: (event) => events.push(`${event.kind}:${event.caseId}`),
    });

    expect(events).toEqual(['case_started:p1', 'case_completed:p1']);
  });

  it('rejects an empty dataset and an unknown baseline id', async () => {
    const kernel = new FakeKernel();
    const service = createService(kernel);

    await expect(service.runExperiment({ dataset: makeDataset([]), config: makeConfig() })).rejects.toThrow(
      'has no cases'
    );
    await expect(
      service.runExperiment({ dataset: makeDataset([makeCase('x')]), config: makeConfig(), baselineId: 'missing' })
    ).rejects.toThrow('Baseline missing not found');
  });
});

function fullMetrics(overrides: Partial<Record<EvaluationMetricId, number>> = {}): Record<EvaluationMetricId, number> {
  return {
    task_completion: 1,
    tool_recall: 1,
    tool_precision: 1,
    tool_error_rate: 1,
    argument_validity: 1,
    max_tool_calls: 1,
    evidence_presence: 1,
    provenance_presence: 1,
    freshness_compliance: 1,
    partial_failure_honesty: 1,
    latency: 1,
    failure_recovery: 1,
    groundedness: 1,
    research_completeness: 1,
    financial_reasoning: 1,
    decision_usefulness: 1,
    trajectory_quality: 1,
    ...overrides,
  };
}

function makeBaseline(overrides: Partial<EvaluationBaseline> = {}): EvaluationBaseline {
  return {
    id: 'baseline-test',
    name: 'test baseline',
    datasetId: 'test-dataset',
    datasetVersion: '1.0.0',
    experimentId: 'exp-past',
    gitSha: 'abc',
    createdAt: 0,
    metrics: fullMetrics(),
    thresholds: {},
    ...overrides,
  };
}

describe('ExperimentService gate evaluation (spec §109)', () => {
  it('fails the gate when critical tool accuracy regresses past maxDelta', async () => {
    // Baseline tool accuracy 0.95 vs current 0.5 (one perfect run, one failed
    // run), critical task_completion maxDelta 0.03 → delta -0.45 → gate FAIL.
    const dataset = makeDataset([makeCase('g-pass', { expected: { mustHaveEvidence: true } }), makeCase('g-fail')]);
    const kernel = new FakeKernel();
    scriptSuccess(kernel, 'g-pass');
    kernel.script('g-fail', { status: 'failed', error: { code: 'RUNTIME_CRASH', message: 'crashed' } });
    const service = createService(kernel);
    const experiment = await service.runExperiment({ dataset, config: makeConfig() });
    expect(
      experiment.summary!.metricAggregates.find((entry) => entry.metric === 'task_completion')?.score
    ).toBeCloseTo(0.5);

    const baseline = makeBaseline({
      metrics: fullMetrics({ task_completion: 0.95, tool_recall: 1, tool_precision: 1 }),
      thresholds: { task_completion: 0.03 },
    });

    const gate = service.evaluateGate(experiment.summary!, baseline);
    const tcRegression = gate.regressions.find((regression) => regression.metric === 'task_completion');
    expect(tcRegression?.baseline).toBe(0.95);
    expect(tcRegression?.current).toBeCloseTo(0.5);
    expect(tcRegression?.delta).toBeCloseTo(-0.45);
    expect(tcRegression?.maxDelta).toBe(0.03);
    expect(tcRegression?.critical).toBe(true);
    expect(tcRegression?.passed).toBe(false);
    expect(gate.passed).toBe(false);
  });

  it('passes the gate when the regression stays within maxDelta', async () => {
    const dataset = makeDataset([makeCase('ok1', { expected: { requiredCapabilities: ['market.quote'] } }), makeCase('ok2')]);
    const kernel = new FakeKernel();
    scriptSuccess(kernel, 'ok1');
    kernel.script('ok2', { status: 'failed', error: { code: 'RUNTIME_CRASH', message: 'crashed' } });
    const service = createService(kernel);
    const experiment = await service.runExperiment({ dataset, config: makeConfig() });

    // Current aggregate task_completion = 0.5; baseline 0.45 tolerates it.
    const baseline = makeBaseline({
      metrics: fullMetrics({ task_completion: 0.45 }),
      thresholds: { task_completion: 0.1 },
    });

    const gate = service.evaluateGate(experiment.summary!, baseline);
    expect(gate.regressions.find((regression) => regression.metric === 'task_completion')?.passed).toBe(true);
    expect(gate.passed).toBe(true);
  });

  it('passes the gate when a non-critical metric regresses', async () => {
    // freshness_compliance is not critical (spec §76-77): a regression there
    // must not fail the gate. The quote call is fresh enough to satisfy every
    // critical metric but violates the case's 60s freshness requirement.
    const dataset = makeDataset([
      makeCase('n1', {
        expected: { requiredCapabilities: ['market.quote'], freshnessRequirementMs: 60_000, mustHaveEvidence: true },
      }),
    ]);
    const kernel = new FakeKernel();
    scriptSuccess(kernel, 'n1');
    const service = createService(kernel);
    const experiment = await service.runExperiment({ dataset, config: makeConfig() });

    const baseline = makeBaseline({
      metrics: fullMetrics({ freshness_compliance: 1 }),
      thresholds: { freshness_compliance: 0.01 },
    });

    const gate = service.evaluateGate(experiment.summary!, baseline);
    expect(gate.regressions.find((regression) => regression.metric === 'freshness_compliance')?.passed).toBe(false);
    expect(gate.passed).toBe(true);
  });

  it('creates a baseline from experiment metrics for later comparison', async () => {
    const dataset = makeDataset([makeCase('b1')]);
    const kernel = new FakeKernel();
    scriptSuccess(kernel, 'b1');
    const service = createService(kernel);
    const experiment = await service.runExperiment({ dataset, config: makeConfig() });

    const baseline = await service.createBaselineFromExperiment(experiment, 'my-first-baseline');

    expect(baseline.id).toMatch(/^baseline-/);
    expect(baseline.name).toBe('my-first-baseline');
    expect(baseline.datasetId).toBe('test-dataset');
    expect(baseline.metrics.task_completion).toBe(1);
    expect((await store.listBaselines())).toHaveLength(1);

    // A follow-up run gated against the stored baseline resolves it by id.
    const stored = (await store.listBaselines())[0];
    const experiment2 = await service.runExperiment({
      dataset: makeDataset([makeCase('c1'), makeCase('c2')]),
      config: makeConfig(),
      baselineId: stored.id,
    });
    expect(experiment2.baselineId).toBe(stored.id);
    expect(experiment2.summary?.passRate).toBe(1);
  });
});

describe('JudgeClient wiring', () => {
  it('builds a client from FINAGENT_JUDGE_* env (createJudgeClient contract)', async () => {
    const client = createJudgeClient({
      provider: 'anthropic',
      model: 'claude-judge',
      apiKey: 'sk-test',
      fetchImpl: (async () =>
        new Response(JSON.stringify({ content: [{ type: 'text', text: '{"score": 0.5, "reason": "ok"}' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })) as unknown as typeof fetch,
    });
    const reply = await client.complete('sys', 'user');
    expect(reply).toContain('0.5');
  });
});

describe('ExperimentService case timeout teardown (#115)', () => {
  it('times out, cancels the underlying run, and records the partial answer', async () => {
    const kernel = new StalledKernel();
    kernel.script('a1', { partialAnswer: 'partial answer', toolCalls: [QUOTE_TOOLCALL] });
    const service = createStalledService(kernel, { terminalGraceMs: 30, teardownMs: 200 });

    const experiment = await service.runExperiment({
      dataset: makeDataset([makeCase('a1')]),
      config: makeConfig({ timeoutMs: 20 }),
    });

    expect(experiment.status).toBe('completed');
    expect(kernel.cancelCalls).toBe(1);
    expect(kernel.deletedSessions).toBe(1);
    const [run] = await store.listRuns(experiment.id);
    expect(run).toMatchObject({ status: 'timeout', answer: 'partial answer' });
    expect(run?.failureModes).toContain('timeout');
    expect(run?.toolCalls).toHaveLength(1);
  });

  it('stalls before its first output and still records a timeout outcome', async () => {
    const kernel = new StalledKernel();
    const service = createStalledService(kernel, { terminalGraceMs: 30, teardownMs: 200 });

    const experiment = await service.runExperiment({
      dataset: makeDataset([makeCase('a1')]),
      config: makeConfig({ timeoutMs: 20 }),
    });

    expect(experiment.status).toBe('completed');
    expect(kernel.cancelCalls).toBe(1);
    const [run] = await store.listRuns(experiment.id);
    expect(run?.status).toBe('timeout');
    expect(run?.answer).toBeUndefined();
    expect(await store.listResults(experiment.id)).toHaveLength(1);
  });

  it('isolates a runtime that ignores cancellation and fails the experiment', async () => {
    const kernel = new StalledKernel();
    kernel.cancelResponds = false;
    kernel.script('a1', { partialAnswer: 'partial answer' });
    const service = createStalledService(kernel, { terminalGraceMs: 20, teardownMs: 30 });

    const experiment = await service.runExperiment({
      dataset: makeDataset([makeCase('a1'), makeCase('a2')]),
      config: makeConfig({ timeoutMs: 20 }),
    });

    expect(experiment.status).toBe('failed');
    expect(kernel.startedRuns).toBe(1); // a2 never starts on the stuck runtime
    expect(experiment.runIds).toHaveLength(1);
    expect(kernel.deletedSessions).toBe(0); // session files still owned by the active run
    const [run] = await store.listRuns(experiment.id);
    expect(run?.status).toBe('timeout');
    expect(run?.error?.code).toBe('RUNTIME_TEARDOWN_TIMEOUT');
    expect(run?.failureModes).toContain('runtime_error');
    expect(await store.listResults(experiment.id)).toHaveLength(1); // artifacts stay readable
  });

  it('bounds the cancellation round-trip itself when the runtime never answers', async () => {
    const kernel = new StalledKernel();
    kernel.hangCancel = true;
    kernel.script('a1', { partialAnswer: 'partial answer' });
    const service = createStalledService(kernel, { terminalGraceMs: 20, teardownMs: 30 });

    const experiment = await service.runExperiment({
      dataset: makeDataset([makeCase('a1'), makeCase('a2')]),
      config: makeConfig({ timeoutMs: 20 }),
    });

    // The cancel promise never resolves, yet the experiment still ends inside
    // the short teardown budget and the stuck runtime is isolated.
    expect(experiment.status).toBe('failed');
    expect(kernel.startedRuns).toBe(1); // a2 never starts on the stuck runtime
    expect(kernel.deletedSessions).toBe(0); // session files still owned by the active run
    expect(kernel.cancelRequests).toEqual([{ sessionId: 'sess-1', runId: 'run-1' }]); // exact ids
    const [run] = await store.listRuns(experiment.id);
    expect(run?.status).toBe('timeout');
    expect(run?.answer).toBe('partial answer');
    expect(run?.error?.code).toBe('RUNTIME_TEARDOWN_TIMEOUT');
    expect(await store.listResults(experiment.id)).toHaveLength(1); // artifacts stay readable
  });

  it('records a completion that loses the race against the timeout only once', async () => {
    const kernel = new StalledKernel();
    kernel.script('a1', { partialAnswer: 'partial', lateCompleteMs: 90, lateCompleteAnswer: 'late answer' });
    const service = createStalledService(kernel, { terminalGraceMs: 30, teardownMs: 200 });

    const experiment = await service.runExperiment({
      dataset: makeDataset([makeCase('a1')]),
      config: makeConfig({ timeoutMs: 20 }),
    });

    // The timeout won the race; the late completion must not re-open the case.
    expect(experiment.status).toBe('completed');
    expect(experiment.runIds).toHaveLength(1);
    const [run] = await store.listRuns(experiment.id);
    expect(run?.status).toBe('timeout');
    expect(await store.listResults(experiment.id)).toHaveLength(1);
  });

  it('user abort cancels the active run and keeps the case outcome', async () => {
    const kernel = new StalledKernel();
    kernel.script('a1', { partialAnswer: 'partial answer' });
    const service = createStalledService(kernel, { terminalGraceMs: 30, teardownMs: 200 });
    const controller = new AbortController();

    const experiment = await service.runExperiment({
      dataset: makeDataset([makeCase('a1'), makeCase('a2')]),
      config: makeConfig({ timeoutMs: 60_000 }),
      signal: controller.signal,
      onProgress: (event) => {
        if (event.kind === 'case_started' && event.caseId === 'a1') controller.abort();
      },
    });

    expect(experiment.status).toBe('cancelled');
    expect(kernel.startedRuns).toBe(1);
    expect(kernel.cancelCalls).toBe(1);
    expect(kernel.deletedSessions).toBe(1);
    expect(experiment.runIds).toHaveLength(1); // the aborted case keeps its outcome
    const [run] = await store.listRuns(experiment.id);
    expect(run?.status).toBe('cancelled');
    expect(run?.answer).toBe('partial answer');
  });
});