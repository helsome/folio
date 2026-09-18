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
  EffectiveRuntimeConfig,
  EvaluationBaseline,
  EvaluationCase,
  EvaluationDataset,
  EvaluationExperiment,
  EvaluationFailureMode,
  EvaluationResultRecord,
  EvaluationRun,
  EvaluationRunStatus,
  EvaluationScore,
  ExperimentConfig,
  ExperimentMetadata,
  RegressionResult,
  Run,
  SupportedLocale,
  ToolCall,
  ToolCallRecord,
  UnappliedConfigItem,
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
import { LangfuseEvaluationBackend } from './langfuse/backend.ts';
import { scoresFromEvaluation } from './langfuse/scores.ts';

/**
 * LLM control surface the runner needs to apply + verify experiment config
 * (#114). Structural subset of `LlmRuntimeApi` (Pi adapter) so fakes stay
 * minimal; `setModel`/`setThinkingLevel` are optional so a control surface
 * that cannot switch models is representable (→ explicit unapplied/error).
 */
export interface ExperimentLlmControl {
  getState(): Promise<{
    sessionId?: string;
    model?: { id?: string; provider?: string } | null;
    thinkingLevel?: string;
  }>;
  setModel?(provider: string, modelId: string): Promise<unknown>;
  setThinkingLevel?(level: string): Promise<unknown>;
}

/** The kernel surface the runner depends on (AgentKernel satisfies it). */
export interface ExperimentKernel {
  sessions: {
    createSession(title?: string): Promise<{ id: string }>;
  };
  runs: {
    subscribe(listener: (event: AgentEvent) => void): () => void;
    startRun(
      sessionId: string,
      content: string,
      workspaceContext?: WorkspaceContext,
      locale?: SupportedLocale
    ): Promise<Run>;
    /** True while a run's terminal persistence is still landing (AgentKernel). */
    isRunning?(): boolean;
    /** Idempotently cancel the given run (RunManager.cancelRun; no-op on id mismatch). */
    cancelRun?(sessionId: string, runId: string): Promise<void> | void;
  };
  deleteSession(sessionId: string): Promise<void>;
  getLlmApi?(): ExperimentLlmControl | undefined;
}

export interface ExperimentServiceOptions {
  store: EvaluationStore;
  kernel: ExperimentKernel;
  backend: EvaluationBackend;
  correlation: TraceCorrelationService;
  now?: () => number;
  /** Test/ops overrides for the runner's wait budgets (§79 guardrails). */
  timing?: {
    /** Grace on top of the case budget before the runner gives up waiting. */
    terminalGraceMs?: number;
    /** Bounded wait for terminal persistence / runtime teardown after a settle. */
    teardownMs?: number;
  };
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
/** Bounded wait for the runtime to finish terminal persistence after a settle. */
const RUNTIME_TEARDOWN_MS = 10_000;

/** Mapped by the runner: rpc timeout → run status `timeout` (spec §44). */
const TIMEOUT_ERROR_CODE = 'PI_REQUEST_TIMEOUT';
const CANCELLED_ERROR_CODE = 'RUN_CANCELLED';

/**
 * Requested experiment config that could not be applied to the runtime (#114).
 * The run fails with this code instead of silently executing under the
 * runtime's previous/default model — a mislabeled A/B is worse than no run.
 */
const CONFIG_APPLY_ERROR_CODE = 'CONFIG_APPLY_FAILED';

function configApplyError(message: string): ApiError {
  return { code: CONFIG_APPLY_ERROR_CODE, message };
}

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

/** A `sleep` whose timer is cleared once the race it arbitrates has settled. */
function deadline(ms: number): { promise: Promise<'timeout'>; clear(): void } {
  const { promise, resolve } = Promise.withResolvers<'timeout'>();
  const timer = setTimeout(() => resolve('timeout'), ms);
  return { promise, clear: () => clearTimeout(timer) };
}

/** Last terminal event for `runId` in the collected stream, if one landed. */
function findTerminalEvent(events: AgentEvent[], runId: string): AgentEvent | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.runId === runId && (event.type === 'run_completed' || event.type === 'run_failed')) {
      return event;
    }
  }
  return undefined;
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
  private readonly terminalGraceMs: number;
  private readonly teardownMs: number;

  constructor(options: ExperimentServiceOptions) {
    this.store = options.store;
    this.kernel = options.kernel;
    this.backend = options.backend;
    this.correlation = options.correlation;
    this.now = options.now ?? Date.now;
    this.terminalGraceMs = options.timing?.terminalGraceMs ?? TERMINAL_GRACE_MS;
    this.teardownMs = options.timing?.teardownMs ?? RUNTIME_TEARDOWN_MS;
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
    const runs: EvaluationRun[] = [];
    let aborted = signal?.aborted ?? false;
    let runtimeUnusable = false;

    for (let index = 0; index < selectedCases.length; index += 1) {
      if (aborted || signal?.aborted) {
        aborted = true;
        break;
      }
      const caseItem = selectedCases[index];
      input.onProgress?.({ kind: 'case_started', caseId: caseItem.id, index, total: selectedCases.length });

      const outcome = await this.runCase(caseItem, dataset, experiment, config, input.judgeClient, signal);
      if (outcome.run) {
        experiment.runIds.push(outcome.run.id);
        runs.push(outcome.run);
        await this.store.addRun(outcome.run);
      }
      if (outcome.result) {
        experiment.resultIds.push(outcome.result.id);
        results.push(outcome.result);
        await this.store.addResult(outcome.result);
      }
      await this.store.updateExperiment(experiment);
      if (outcome.aborted) {
        aborted = true;
        break;
      }
      if (outcome.runtimeUnusable) {
        // The runtime ignored cancellation and never settled: do not start the
        // next case into a kernel that still owns an active run.
        runtimeUnusable = true;
        input.onProgress?.({ kind: 'case_completed', caseId: caseItem.id, index, total: selectedCases.length });
        break;
      }

      input.onProgress?.({ kind: 'case_completed', caseId: caseItem.id, index, total: selectedCases.length });
    }

    if (runtimeUnusable && !aborted) {
      // Infra breakdown: the experiment ends explicitly while everything already
      // produced stays persisted and readable.
      experiment.status = 'failed';
    } else if (aborted) {
      experiment.status = 'cancelled';
    } else {
      experiment.status = 'completed';
    }
    experiment.completedAt = this.now();
    experiment.summary = summarizeExperiment(runs, results, selectedCases);
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

  /**
   * Apply the experiment's requested model/provider/thinking to the runtime
   * BEFORE the case session runs, then confirm by readback (#114).
   *
   * Semantics:
   * - model+provider requested → must apply via the runtime control surface
   *   and read back the SAME model; application failure or readback mismatch
   *   returns an error (the caller fails the run — never a silent fallback).
   * - Nothing (or partially) requested → the runtime's current state is read
   *   back so the run records what will actually execute, not what was hoped.
   * - Dimensions with no runtime control surface (strategyId; everything in
   *   fixture mode) are recorded as `unapplied` with a reason — explicitly
   *   marked, never presented as if they were in effect.
   * - Called once per case so consecutive experiments cannot inherit each
   *   other's configuration.
   */
  private async applyRequestedConfig(config: ExperimentConfig): Promise<{ effective?: EffectiveRuntimeConfig; error?: ApiError }> {
    const llm = this.kernel.getLlmApi?.();
    const unapplied: UnappliedConfigItem[] = [];
    if (config.strategyId) {
      unapplied.push({ key: 'strategyId', reason: 'no runtime control surface for strategy loading' });
    }

    // Local/fixture runtime: nothing can be applied. Requested dimensions are
    // explicitly marked unapplied; the deterministic local runtime is the
    // honest record of what ran.
    if (!llm) {
      const reason = 'runtime exposes no LLM control surface (local/fixture mode)';
      if (config.model) unapplied.push({ key: 'model', reason });
      if (config.provider) unapplied.push({ key: 'provider', reason });
      if (config.thinkingLevel) unapplied.push({ key: 'thinkingLevel', reason });
      return unapplied.length > 0 ? { effective: { unapplied, confirmedAt: this.now() } } : {};
    }

    try {
      let appliedModel: { id?: string; provider?: string } | undefined;
      let appliedThinking: string | undefined;

      if (config.model && config.provider) {
        if (!llm.setModel) {
          return {
            error: configApplyError(
              `Runtime LLM control does not support setModel; cannot honor requested model ${config.provider}/${config.model}.`
            ),
          };
        }
        await llm.setModel(config.provider, config.model);
        const state = await llm.getState();
        const actual = state.model;
        if (!actual || actual.id !== config.model || actual.provider !== config.provider) {
          return {
            error: configApplyError(
              `Runtime readback shows ${actual ? `${actual.provider}/${actual.id}` : 'no model'} after setModel(${config.provider}/${config.model}); blocking the run instead of recording a mislabeled comparison.`
            ),
          };
        }
        appliedModel = { id: actual.id, provider: actual.provider };
      } else {
        if (config.model) {
          unapplied.push({
            key: 'model',
            reason: 'no provider resolved for the requested model; setModel requires an explicit provider',
          });
        }
        if (config.provider) {
          unapplied.push({
            key: 'provider',
            reason: 'no model id requested; a provider override alone cannot be applied',
          });
        }
        // Nothing to apply for the model: read back what the runtime will
        // actually use, so the run metadata reflects reality.
        const state = await llm.getState();
        appliedModel = state.model ? { id: state.model.id, provider: state.model.provider } : undefined;
      }

      if (config.thinkingLevel) {
        if (!llm.setThinkingLevel) {
          unapplied.push({ key: 'thinkingLevel', reason: 'runtime LLM control does not expose setThinkingLevel' });
        } else {
          await llm.setThinkingLevel(config.thinkingLevel);
          const state = await llm.getState();
          if (state.thinkingLevel !== config.thinkingLevel) {
            return {
              error: configApplyError(
                `Runtime readback shows thinkingLevel '${state.thinkingLevel}' after setThinkingLevel('${config.thinkingLevel}'); blocking the run instead of recording a mislabeled dimension.`
              ),
            };
          }
          appliedThinking = state.thinkingLevel;
        }
      }

      const effective: EffectiveRuntimeConfig = {
        ...(appliedModel?.id ? { model: appliedModel.id } : {}),
        ...(appliedModel?.provider ? { provider: appliedModel.provider } : {}),
        ...(appliedThinking ? { thinkingLevel: appliedThinking } : {}),
        ...(unapplied.length > 0 ? { unapplied } : {}),
        confirmedAt: this.now(),
      };
      return { effective };
    } catch (error) {
      return {
        error: {
          code: CONFIG_APPLY_ERROR_CODE,
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /** Run one case: fresh session → run → collect → evaluate → persist. */
  private async runCase(
    caseItem: EvaluationCase,
    dataset: EvaluationDataset,
    experiment: EvaluationExperiment,
    config: ExperimentConfig,
    judgeClient: JudgeClient | undefined,
    signal?: AbortSignal,
  ): Promise<{ run?: EvaluationRun; result?: EvaluationResultRecord; aborted: boolean; runtimeUnusable: boolean }> {
    const session = await this.kernel.sessions.createSession(caseItem.id);
    const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const startedAt = this.now();

    // #114: apply + verify the requested config BEFORE anything runs. A
    // failure here is terminal for the case: the run is recorded as failed
    // with CONFIG_APPLY_FAILED rather than executing under whatever model the
    // runtime happened to still be on.
    const applied = await this.applyRequestedConfig(config);
    if (applied.error) {
      const failedRun: EvaluationRun = {
        id: `run-${randomSuffix(8)}`,
        experimentId: experiment.id,
        caseId: caseItem.id,
        datasetId: dataset.id,
        status: 'failed',
        startedAt,
        completedAt: this.now(),
        failureModes: ['runtime_error'],
        error: applied.error,
        toolCalls: [],
        // The agent never ran: a config failure is infra-invalid, not a
        // measurable zero (#113).
        execution: 'not-started',
      };
      await this.traceRun(failedRun, session.id, caseItem.locale);
      await this.kernel.deleteSession(session.id).catch(() => undefined);
      return { run: failedRun, aborted: false, runtimeUnusable: false };
    }

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
        run = await this.kernel.runs.startRun(
          session.id,
          caseItem.input.prompt,
          caseItem.input.workspaceContext,
          caseItem.locale
        );
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
          execution: 'not-started',
        };
        await this.traceRun(failedRun, session.id, caseItem.locale);
        await this.kernel.deleteSession(session.id).catch(() => undefined);
        return { run: failedRun, aborted: false, runtimeUnusable: false };
      }
      if (!runId) runId = run.id;

      const abortResolved = Promise.withResolvers<'abort'>();
      const abortPromise = abortResolved.promise;
      const onAbort = (): void => abortResolved.resolve('abort');
      if (signal?.aborted) {
        abortResolved.resolve('abort');
      } else {
        signal?.addEventListener('abort', onAbort, { once: true });
      }
      const waitTimer = deadline(timeoutMs + this.terminalGraceMs);

      const settled = await Promise.race([terminal, waitTimer.promise, abortPromise]);
      waitTimer.clear();
      signal?.removeEventListener('abort', onAbort);
      const completedAt = this.now();

      // Exactly one settlement wins the race; a late terminal event must not
      // re-open the case. From here the runner owns the outcome.
      const userAborted = settled === 'abort';
      const hardTimeout = settled === 'timeout';
      const cancelRequested = (userAborted || hardTimeout) && runId !== undefined;

      // RunManager clears `activeRun` only after all terminal persistence lands
      // (run update, session idle, messages). Deleting the session or starting
      // the next case before that races on the same session-store files (§55).
      // The cancellation round-trip and the idle wait share ONE bounded window:
      // RunManager.cancelRun awaits runtime.cancel, so a runtime that never
      // answers cancellation must not extend the hang past the teardown budget.
      const idle = await this.settleTeardown(session.id, runId, cancelRequested);

      const terminalEvent = hardTimeout
        ? undefined
        : userAborted
          ? findTerminalEvent(collected, runId)
          : (settled as AgentEvent);
      const outcome = this.deriveOutcome(
        terminalEvent,
        collected,
        runId,
        run,
        userAborted ? { status: 'cancelled', failureModes: [] as EvaluationFailureMode[] } : undefined
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
        ...(applied.effective ? { effectiveConfig: applied.effective } : {}),
      };
      if (!idle) {
        // The runtime ignored cancellation (or never settled): isolate it.
        // Session files are still owned by the active run and must not be
        // touched; the caller stops the experiment instead of reusing the
        // still-active context for the next case.
        evalRun.error ??= {
          code: 'RUNTIME_TEARDOWN_TIMEOUT',
          message: `Runtime did not finish terminal persistence within ${this.teardownMs}ms after the case settled.`,
        };
        evalRun.failureModes = [...evalRun.failureModes, 'runtime_error'];
      }
      const traceRef = await this.traceRun(evalRun, session.id, caseItem.locale, {
        prompt: caseItem.input.prompt,
        datasetId: dataset.id,
        datasetVersion: dataset.version,
        goldCaseId: caseItem.id,
        // Readback-confirmed values ONLY (#114). A dimension the runtime never
        // confirmed (no control surface, or recorded as unapplied) stays
        // unknown in the trace — the requested value is recorded under its own
        // name and is never promoted to the actual model label.
        ...(evalRun.effectiveConfig?.model ? { model: evalRun.effectiveConfig.model } : {}),
        ...(evalRun.effectiveConfig?.provider ? { provider: evalRun.effectiveConfig.provider } : {}),
        requestedModel: config.model,
        requestedProvider: config.provider,
      });
      evalRun.traceRef = traceRef;
      if (idle) {
        await this.kernel.deleteSession(session.id).catch(() => undefined);
      }

      if (userAborted) {
        // User-cancelled case: the partial evidence stays on the record instead
        // of silently dropping the case from the experiment statistics.
        return { run: evalRun, aborted: true, runtimeUnusable: !idle };
      }

      // ── Evaluation (spec §27-38): deterministic first, judges when a client
      // is configured. Only completed runs are measurable: a failed/timeout
      // run never produced a finished agent trajectory, so rule metrics would
      // emit phantom passes (e.g. "no tool calls made" = 1.0) and judge calls
      // would waste credits on an empty answer (issue #113). Such runs still
      // carry a verdict (`fail`) and stay in the quality aggregates as real
      // negative results when they started; only not-started config failures
      // and explicit runtime/process failures are infrastructure.
      let scores: EvaluationScore[] = [];
      if (evalRun.status === 'completed') {
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
        const evaluated = await registry.evaluateAll(context, { includeJudges: judgeClient !== undefined });
        scores = evaluated.scores;
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
          judgeErrors.length > 0 && !evaluated.failures.includes('judge_error')
            ? [...evaluated.failures, 'judge_error']
            : evaluated.failures;
        evalRun.failureModes = [...new Set([...evalRun.failureModes, ...allFailures])];
      }

      const result: EvaluationResultRecord = {
        id: `result-${randomSuffix(8)}`,
        runId: evalRun.id,
        experimentId: experiment.id,
        caseId: caseItem.id,
        scores,
        failureModes: evalRun.failureModes,
        verdict: verdictForRun(evalRun),
      };
      await this.writeLangfuseScores(evalRun, scores);
      return { run: evalRun, result, aborted: false, runtimeUnusable: !idle };
    } finally {
      unsubscribe?.();
    }
  }

  /**
   * Bounded teardown (§55 — one prompt at a time): issue the idempotent
   * cancellation when requested and wait for the kernel to finish terminal
   * persistence inside ONE window. Returns false when the runtime is still
   * running — or the cancellation round-trip is still pending — after the
   * budget, i.e. cancellation was ignored or never landed.
   */
  private async settleTeardown(sessionId: string, runId: string, cancel: boolean): Promise<boolean> {
    const giveUpAt = this.now() + this.teardownMs;
    // A late rejection must never escape: it is swallowed at the source and the
    // race below simply keeps waiting for the idle deadline. RunManager no-ops
    // when the run already settled or the ids do not match its active run.
    const cancellation = cancel
      ? Promise.resolve(this.kernel.runs.cancelRun?.(sessionId, runId)).catch(() => undefined)
      : undefined;

    const idle = (async (): Promise<boolean> => {
      while (this.kernel.runs.isRunning?.() ?? false) {
        if (this.now() >= giveUpAt) return false;
        await sleep(5);
      }
      return true;
    })();
    if (!cancellation) return idle;

    const settled = await Promise.race([idle, cancellation.then(() => 'cancel' as const)]);
    // Cancellation settled first: keep waiting for the (still bounded) idle.
    return settled === 'cancel' ? idle : settled;
  }

  /** Persist the trace link for a finished run; never throws. */
  private async traceRun(
    run: EvaluationRun,
    folioSessionId: string,
    locale?: SupportedLocale,
    extras?: {
      prompt?: string;
      datasetId?: string;
      datasetVersion?: string;
      goldCaseId?: string;
      /**
       * Runtime config confirmed by READBACK (#114) — omit the key entirely
       * when the runtime state is unknown. Never pass a requested value here.
       */
      model?: string;
      provider?: string;
      /** Requested values, recorded under their own names (never as actuals). */
      requestedModel?: string;
      requestedProvider?: string;
    }
  ): Promise<EvaluationRun['traceRef']> {
    try {
      if (this.backend instanceof LangfuseEvaluationBackend) {
        return await this.backend.exportAgentRun({
          folioRunId: run.id,
          sessionId: folioSessionId,
          startedAt: run.startedAt,
          completedAt: run.completedAt ?? this.now(),
          input: extras?.prompt,
          output: run.answer,
          toolCalls: run.toolCalls,
          error: run.error,
          model: extras?.model,
          provider: extras?.provider,
          metadata: {
            folioRunId: run.id,
            folioSessionId,
            runKind: 'evaluation',
            goldCaseId: extras?.goldCaseId ?? run.caseId,
            datasetId: extras?.datasetId ?? run.datasetId,
            datasetVersion: extras?.datasetVersion,
            model: extras?.model,
            provider: extras?.provider,
            requestedModel: extras?.requestedModel,
            requestedProvider: extras?.requestedProvider,
            folioVersion: currentFolioVersion(),
            locale,
          },
        });
      }
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
        locale,
      });
    } catch {
      return undefined;
    }
  }

  private async writeLangfuseScores(run: EvaluationRun, scores: EvaluationScore[]): Promise<void> {
    const traceId = run.traceRef?.traceId;
    if (!traceId || !this.backend.submitScores) return;
    try {
      const mapped = scoresFromEvaluation(scores);
      if (typeof run.latencyMs === 'number' && !mapped.some((score) => score.name === 'latency_ms')) {
        mapped.push({ name: 'latency_ms', value: run.latencyMs });
      }
      if (mapped.length === 0) return;
      await this.backend.submitScores(traceId, mapped);
    } catch {
      // Score writeback is best-effort.
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
    fallback?: { status: EvaluationRunStatus; failureModes: EvaluationFailureMode[] },
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
      // Only reached when the wait budget expired or the user aborted without a
      // terminal event; the partial evidence stays on the record.
      return {
        runId,
        status: fallback?.status ?? 'timeout',
        answer,
        toolCalls,
        failureModes: fallback?.failureModes ?? ['timeout'],
        error,
      };
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
 *
 * Refuses experiments whose execution validity is not `valid` (issue #113):
 * a baseline built from infrastructure failures would be a misleading
 * benchmark floor, and once stored it is compared against silently.
 */
export async function createBaselineFromExperiment(
  store: EvaluationStore,
  experiment: EvaluationExperiment,
  name?: string,
  thresholds?: EvaluationBaseline['thresholds'],
): Promise<EvaluationBaseline> {
  const validity = experiment.summary?.validity;
  if (validity !== 'valid') {
    throw new Error(
      `Cannot create a baseline from experiment ${experiment.id}: execution validity is ` +
        `'${validity ?? 'unknown'}' (reasons: ${experiment.summary?.validityReasons.join(', ') || 'n/a'}). ` +
        'Only a fully valid experiment may seed a baseline.'
    );
  }
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
