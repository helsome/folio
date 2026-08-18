// Experiment runner (spec §42-45, §70-71, §79).
//
// Owns the run lifecycle end to end: fresh session per case, sequential runs
// through the agent kernel (Pi runs one prompt at a time — concurrency is 1),
// terminal-state collection from the kernel's AgentEvent stream, deterministic
// + optional LLM-judge evaluation, and durable persistence via EvaluationStore.
//
// Per spec §42-45 the experiment record carries full metadata (gitSha,
// folio/runtime/Pi versions, provider configuration) so historical experiments
// stay comparable. Per spec §79 cost guardrails (maxCases, timeoutMs) are
// enforced here. Failure modes are recorded by the evaluators: the run starts
// with outcome-derived modes (timeout/runtime_error), then the
// evaluator-returned failures (e.g. judge_error) are appended — the verdict
// never depends on the evaluator pass, it is computed from the run record.
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AgentEvent,
  ApiError,
  EvaluationBaseline,
  EvaluationCase,
  EvaluationDataset,
  EvaluationExperiment,
  EvaluationFailureMode,
  EvaluationResultRecord,
  EvaluationRun,
  EvaluationRunStatus,
  ExperimentConfig,
  ExperimentMetadata,
  RegressionResult,
  Run,
  ToolCall,
  ToolCallRecord,
  WorkspaceContext,
} from '@finagent/core';
import type { EvaluationBackend } from './backend.ts';
import {
  compareToBaseline,
  gatePassed,
  summarizeExperiment,
  summarizeMetricsForComparison,
  verdictForRun,
} from './aggregate.ts';
import { TraceCorrelationService } from './correlation.ts';
import { EvaluatorRegistry, type EvaluationContext } from './evaluator.ts';
import { registerDeterministicEvaluators } from './evaluators/index.ts';
import { registerJudges } from './judges/index.ts';
import type { JudgeClient } from './judge-client.ts';
import { DEFAULT_EVALUATION_SETTINGS } from './settings.ts';
import { EvaluationStore } from './store.ts';

/** The kernel surface the runner depends on (AgentKernel satisfies it). */
export interface ExperimentKernel {
  sessions: {
    createSession(title?: string): Promise<{ id: string }>;
  };
  runs: {
    subscribe(listener: (event: AgentEvent) => void): () => void;
    startRun(sessionId: string, content: string, workspaceContext?: WorkspaceContext): Promise<Run>;
    /** True while a run's terminal persistence is still landing (AgentKernel). */
    isRunning?(): boolean;
  };
  deleteSession(sessionId: string): Promise<void>;
  getLlmApi?(): { getState(): Promise<{ sessionId?: string }> } | undefined;
}

export interface ExperimentServiceOptions {
  store: EvaluationStore;
  kernel: ExperimentKernel;
  backend: EvaluationBackend;
  correlation: TraceCorrelationService;
  now?: () => number;
}

export interface RunExperimentInput {
  dataset: EvaluationDataset;
  config: ExperimentConfig;
  name?: string;
  /** Store-backed baseline id to gate against. */
  baselineId?: string;
  /** Pre-resolved baseline (e.g. committed scripts/eval/ci-baselines JSON). */
  baseline?: EvaluationBaseline;
  judgeClient?: JudgeClient;
  onProgress?: (event: { kind: 'case_started' | 'case_completed'; caseId: string; index: number; total: number }) => void;
  signal?: AbortSignal;
}

/** Per-metric regression comparison plus the overall gate verdict (§76-77). */
export interface GateEvaluation {
  regressions: RegressionResult[];
  passed: boolean;
}

/** Default per-run wall-clock budget when the config does not set one (§79). */
const DEFAULT_TIMEOUT_MS = 120_000;
/** Grace margin on top of the runtime budget before the runner gives up waiting. */
const TERMINAL_GRACE_MS = 30_000;

/** Mapped by the runner: rpc timeout → run status `timeout` (spec §44). */
const TIMEOUT_ERROR_CODE = 'PI_REQUEST_TIMEOUT';
const CANCELLED_ERROR_CODE = 'RUN_CANCELLED';

function toToolCallRecord(toolCall: ToolCall): ToolCallRecord {
  return {
    id: toolCall.id,
    toolName: toolCall.toolName,
    args: toolCall.args,
    startedAt: toolCall.startedAt,
    completedAt: toolCall.completedAt,
    status: toolCall.status === 'error' ? 'error' : 'success',
    result: toolCall.result,
    error: toolCall.error,
  };
}

/** Short random suffix for ids: `exp-<ts>-<rand>` (§42). */
function randomSuffix(length: number): string {
  return randomUUID().replaceAll('-', '').slice(0, length);
}

/** Promise resolved after `ms` (used for wait budgets and idle polling). */
function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/** Repo git sha; undefined when the command fails (e.g. not a git checkout). */
export function currentGitSha(): string | undefined {
  try {
    const sha = execSync('git rev-parse HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return sha.length > 0 ? sha : undefined;
  } catch {
    return undefined;
  }
}

/** Folio version from the repo root package.json; undefined when unreadable. */
export function currentFolioVersion(): string | undefined {
  try {
    const raw = readFileSync(join(process.cwd(), 'package.json'), 'utf8');
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === 'string' && parsed.version.length > 0 ? parsed.version : undefined;
  } catch {
    return undefined;
  }
}

function buildMetadata(config: ExperimentConfig, startedAt: number): ExperimentMetadata {
  return {
    gitSha: currentGitSha(),
    folioVersion: currentFolioVersion(),
    runtimeVersion: process.version,
    piVersion: process.env.FINAGENT_PI_VERSION ?? undefined,
    providerConfiguration: {
      model: config.model,
      provider: config.provider,
      thinkingLevel: config.thinkingLevel,
      strategyId: config.strategyId,
      skillVersions: config.skillVersions,
      capabilityRegistryVersion: config.capabilityRegistryVersion,
      judgeModel: config.judgeModel,
      judgeProvider: config.judgeProvider,
    },
    timestamp: startedAt,
  };
}

/** Coerce an unknown thrown value into an ApiError shape. */
function toApiErrorLike(error: unknown): ApiError {
  if (typeof error === 'object' && error !== null && 'code' in error && 'message' in error) {
    const code = (error as { code: unknown }).code;
    const message = (error as { message: unknown }).message;
    return {
      code: typeof code === 'string' ? code : 'RUN_FAILED',
      message: typeof message === 'string' ? message : String(error),
    };
  }
  return { code: 'RUN_FAILED', message: error instanceof Error ? error.message : String(error) };
}

export class ExperimentService {
  private readonly store: EvaluationStore;
  private readonly kernel: ExperimentKernel;
  private readonly backend: EvaluationBackend;
  private readonly correlation: TraceCorrelationService;
  private readonly now: () => number;

  constructor(options: ExperimentServiceOptions) {
    this.store = options.store;
    this.kernel = options.kernel;
    this.backend = options.backend;
    this.correlation = options.correlation;
    this.now = options.now ?? Date.now;
  }

  /**
   * Run an experiment over the dataset. Cases run sequentially (concurrency
   * 1 — the Pi runtime executes one prompt at a time). `maxCases > 0` samples
   * the FIRST N cases in dataset order (documented §79; deterministic sampling
   * keeps PR vs main gate comparisons meaningful).
   */
  async runExperiment(input: RunExperimentInput): Promise<EvaluationExperiment> {
    const { dataset, config, signal } = input;
    if (dataset.cases.length === 0) {
      throw new Error(`Dataset ${dataset.id} has no cases.`);
    }
    if (config.mode !== 'fixture' && config.mode !== 'live') {
      throw new Error(`Unsupported experiment mode: ${String(config.mode)}. Expected 'fixture' or 'live'.`);
    }

    let baseline: EvaluationBaseline | undefined = input.baseline;
    if (input.baselineId) {
      baseline = (await this.store.listBaselines()).find((entry) => entry.id === input.baselineId);
      if (!baseline) {
        throw new Error(`Baseline ${input.baselineId} not found. Run eval:smoke --save-baseline <name> first.`);
      }
    }

    const selectedCases = this.selectCases(dataset.cases, config.maxCases);
    const startedAt = this.now();
    const experiment: EvaluationExperiment = {
      id: `exp-${startedAt}-${randomSuffix(6)}`,
      name: input.name ?? `${dataset.id} ${config.mode} ${new Date(startedAt).toISOString()}`,
      datasetId: dataset.id,
      datasetVersion: dataset.version,
      status: 'running',
      mode: config.mode,
      config,
      metadata: buildMetadata(config, startedAt),
      startedAt,
      runIds: [],
      resultIds: [],
      ...(baseline ? { baselineId: baseline.id } : {}),
    };
    await this.store.createExperiment(experiment);

    const results: EvaluationResultRecord[] = [];
    let aborted = signal?.aborted ?? false;

    for (let index = 0; index < selectedCases.length; index += 1) {
      if (aborted || signal?.aborted) {
        aborted = true;
        break;
      }
      const caseItem = selectedCases[index];
      input.onProgress?.({ kind: 'case_started', caseId: caseItem.id, index, total: selectedCases.length });

      const outcome = await this.runCase(caseItem, dataset, experiment, config, input.judgeClient, signal);
      if (outcome.aborted) {
        aborted = true;
        await this.store.updateExperiment(experiment);
        break;
      }
      if (outcome.run) {
        experiment.runIds.push(outcome.run.id);
        await this.store.addRun(outcome.run);
      }
      if (outcome.result) {
        experiment.resultIds.push(outcome.result.id);
        results.push(outcome.result);
        await this.store.addResult(outcome.result);
      }
      await this.store.updateExperiment(experiment);

      input.onProgress?.({ kind: 'case_completed', caseId: caseItem.id, index, total: selectedCases.length });
    }

    if (aborted) {
      experiment.status = 'cancelled';
    } else {
      experiment.status = 'completed';
    }
    experiment.completedAt = this.now();
    experiment.summary = summarizeExperiment(experiment, results, selectedCases);
    await this.store.updateExperiment(experiment);
    return experiment;
  }

  /**
   * Regression gate (spec §76-77): critical metrics must not regress past
   * their maxDelta. Returns the per-metric comparison plus the gate verdict.
   */
  evaluateGate(summary: NonNullable<EvaluationExperiment['summary']>, baseline: EvaluationBaseline | undefined): GateEvaluation {
    const regressions = compareToBaseline(summary, baseline);
    return { regressions, passed: gatePassed(regressions) };
  }

  /** Persist a baseline from a finished experiment (spec §75-78). */
  async createBaselineFromExperiment(
    experiment: EvaluationExperiment,
    name?: string,
    thresholds?: EvaluationBaseline['thresholds'],
  ): Promise<EvaluationBaseline> {
    return createBaselineFromExperiment(this.store, experiment, name, thresholds);
  }

  /** maxCases > 0 → first N cases in dataset order (deterministic, §79). */
  private selectCases(cases: EvaluationCase[], maxCases: number | undefined): EvaluationCase[] {
    if (typeof maxCases === 'number' && Number.isFinite(maxCases) && maxCases > 0) {
      return cases.slice(0, Math.floor(maxCases));
    }
    return cases;
  }

  /** Run one case: fresh session → run → collect → evaluate → persist. */
  private async runCase(
    caseItem: EvaluationCase,
    dataset: EvaluationDataset,
    experiment: EvaluationExperiment,
    config: ExperimentConfig,
    judgeClient: JudgeClient | undefined,
    signal?: AbortSignal,
  ): Promise<{ run?: EvaluationRun; result?: EvaluationResultRecord; aborted: boolean }> {
    const session = await this.kernel.sessions.createSession(caseItem.id);
    const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const startedAt = this.now();

    const collected: AgentEvent[] = [];
    let runId: string | undefined;
    let unsubscribe: (() => void) | undefined;
    const terminalResolved = Promise.withResolvers<AgentEvent>();
    const terminal = terminalResolved.promise;
    unsubscribe = this.kernel.runs.subscribe((event) => {
      collected.push(event);
      if (event.type === 'run_started') {
        runId = event.runId;
        return;
      }
      if (runId && event.runId === runId && (event.type === 'run_completed' || event.type === 'run_failed')) {
        terminalResolved.resolve(event);
      }
    });

    try {
      let run: Run;
      try {
        run = await this.kernel.runs.startRun(session.id, caseItem.input.prompt, caseItem.input.workspaceContext);
      } catch (error) {
        // Infra-level failure (e.g. runtime spawn failed): record a failed run
        // so the experiment still summarizes, and keep going.
        const failedRun: EvaluationRun = {
          id: `run-${randomSuffix(8)}`,
          experimentId: experiment.id,
          caseId: caseItem.id,
          datasetId: dataset.id,
          status: 'failed',
          startedAt,
          completedAt: this.now(),
          failureModes: ['runtime_error'],
          error: toApiErrorLike(error),
          toolCalls: [],
        };
        await this.traceRun(failedRun, session.id);
        await this.kernel.deleteSession(session.id).catch(() => undefined);
        return { run: failedRun, aborted: false };
      }
      if (!runId) runId = run.id;

      const abortResolved = Promise.withResolvers<'abort'>();
      const abortPromise = abortResolved.promise;
      if (signal?.aborted) {
        abortResolved.resolve('abort');
      } else {
        signal?.addEventListener('abort', () => abortResolved.resolve('abort'), { once: true });
      }
      const waitTimer = sleep(timeoutMs + TERMINAL_GRACE_MS).then(() => 'timeout' as const);

      const settled = await Promise.race([terminal, waitTimer, abortPromise]);
      const completedAt = this.now();

      if (settled === 'abort') {
        await this.kernel.deleteSession(session.id).catch(() => undefined);
        return { aborted: true };
      }

      const hardTimeout = settled === 'timeout';
      const outcome = this.deriveOutcome(
        hardTimeout ? undefined : (settled as AgentEvent),
        collected,
        runId,
        run,
      );
      const evalRun: EvaluationRun = {
        id: outcome.runId,
        experimentId: experiment.id,
        caseId: caseItem.id,
        datasetId: dataset.id,
        status: outcome.status,
        startedAt,
        completedAt,
        latencyMs: completedAt - startedAt,
        answer: outcome.answer,
        toolCalls: outcome.toolCalls,
        failureModes: outcome.failureModes,
        error: outcome.error,
      };
      const traceRef = await this.traceRun(evalRun, session.id);
      evalRun.traceRef = traceRef;
      // RunManager clears `activeRun` only after all terminal persistence lands
      // (run update, session idle, messages). Deleting the session or starting
      // the next case before that races on the same session-store files, so
      // wait for the kernel to go idle first (§55 — one prompt at a time).
      while (this.kernel.runs.isRunning?.() ?? false) {
        await sleep(5);
      }
      await this.kernel.deleteSession(session.id).catch(() => undefined);

      // ── Evaluation (spec §27-38): deterministic first, judges when a client
      // is configured. Evaluator-returned failures append to the run's modes.
      const registry = new EvaluatorRegistry();
      registerDeterministicEvaluators(registry);
      if (judgeClient) {
        registerJudges(registry, judgeClient);
      }
      const context: EvaluationContext = {
        case: caseItem,
        dataset,
        run: evalRun,
        settings: DEFAULT_EVALUATION_SETTINGS,
        toolCalls: evalRun.toolCalls,
        now: this.now,
      };
      const { scores, failures } = await registry.evaluateAll(context, { includeJudges: judgeClient !== undefined });
      // Judge harnesses never throw (spec §107): a null score whose reason
      // carries `judge_error` IS the failure signal — surface it as a mode.
      const judgeMetrics = new Set(
        registry
          .list()
          .filter((definition) => definition.kind === 'llm-judge')
          .map((definition) => definition.metric)
      );
      const judgeErrors = scores.filter(
        (score) =>
          judgeMetrics.has(score.metric) &&
          score.score === null &&
          typeof score.reason === 'string' &&
          score.reason.includes('judge_error')
      );
      const allFailures: EvaluationFailureMode[] =
        judgeErrors.length > 0 && !failures.includes('judge_error') ? [...failures, 'judge_error'] : failures;
      evalRun.failureModes = [...outcome.failureModes, ...allFailures];

      const result: EvaluationResultRecord = {
        id: `result-${randomSuffix(8)}`,
        runId: evalRun.id,
        experimentId: experiment.id,
        caseId: caseItem.id,
        scores,
        failureModes: evalRun.failureModes,
        verdict: verdictForRun(evalRun),
      };
      return { run: evalRun, result, aborted: false };
    } finally {
      unsubscribe?.();
    }
  }

  /** Persist the trace link for a finished run; never throws. */
  private async traceRun(run: EvaluationRun, folioSessionId: string): Promise<EvaluationRun['traceRef']> {
    try {
      let threadId: string | undefined;
      const llmApi = this.kernel.getLlmApi?.();
      if (llmApi) {
        const state = await llmApi.getState();
        threadId = state.sessionId;
      }
      return await this.correlation.recordRun({
        folioRunId: run.id,
        folioSessionId,
        threadId,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
      });
    } catch {
      return undefined;
    }
  }

  /**
   * Terminal-state derivation. Events are the source of truth; the run record
   * returned by `startRun` is the fallback (some runtimes settle it in place).
   */
  private deriveOutcome(
    terminalEvent: AgentEvent | undefined,
    collected: AgentEvent[],
    runId: string,
    runRecord: Run,
  ): {
    runId: string;
    status: EvaluationRunStatus;
    answer?: string;
    toolCalls: ToolCallRecord[];
    failureModes: EvaluationFailureMode[];
    error?: ApiError;
  } {
    const toolCalls: ToolCallRecord[] = [];
    let answer: string | undefined;
    let error: ApiError | undefined;
    let sawCompleted = false;

    for (const event of collected) {
      if (event.runId !== runId) continue;
      if (event.type === 'tool_completed') {
        toolCalls.push(toToolCallRecord(event.payload.toolCall));
      } else if (event.type === 'message_delta' || event.type === 'message_completed') {
        answer = event.payload.answer;
      } else if (event.type === 'run_completed') {
        sawCompleted = true;
        answer = event.payload.answer;
      } else if (event.type === 'run_failed') {
        error = event.payload.error;
      }
    }

    if (terminalEvent === undefined) {
      // Only reached when the wait budget expired without a terminal event.
      return { runId, status: 'timeout', answer, toolCalls, failureModes: ['timeout'], error };
    }
    const code = error?.code;
    if (sawCompleted) {
      return { runId, status: 'completed', answer, toolCalls, failureModes: [], error };
    }
    if (code === CANCELLED_ERROR_CODE || runRecord.status === 'cancelled') {
      return { runId, status: 'cancelled', answer, toolCalls, failureModes: [], error };
    }
    if (code === TIMEOUT_ERROR_CODE) {
      return { runId, status: 'timeout', answer, toolCalls, failureModes: ['timeout'], error };
    }
    if (runRecord.status === 'completed') {
      return { runId, status: 'completed', answer, toolCalls, failureModes: [], error };
    }
    return {
      runId,
      status: 'failed',
      answer,
      toolCalls,
      failureModes: ['runtime_error'],
      error: error ?? { code: 'RUN_FAILED', message: 'Run failed without a terminal error payload.' },
    };
  }
}

/**
 * Build a durable baseline from a finished experiment (spec §75). Metrics are
 * the per-metric aggregate means from `summarizeMetricsForComparison`; missing
 * thresholds fall back to the metric definition defaults during comparison.
 */
export async function createBaselineFromExperiment(
  store: EvaluationStore,
  experiment: EvaluationExperiment,
  name?: string,
  thresholds?: EvaluationBaseline['thresholds'],
): Promise<EvaluationBaseline> {
  const results = await store.listResults(experiment.id);
  const baseline: EvaluationBaseline = {
    id: `baseline-${Date.now()}-${randomSuffix(6)}`,
    name: name ?? `baseline-${experiment.id}`,
    datasetId: experiment.datasetId,
    datasetVersion: experiment.datasetVersion,
    experimentId: experiment.id,
    gitSha: experiment.metadata.gitSha ?? '',
    createdAt: Date.now(),
    metrics: summarizeMetricsForComparison(results),
    thresholds: thresholds ?? {},
  };
  await store.createBaseline(baseline);
  return baseline;
}
