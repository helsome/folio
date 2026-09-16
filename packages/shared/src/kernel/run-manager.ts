import { randomUUID } from 'node:crypto';
import type {
  AgentEvent,
  AgentEventPayload,
  AgentRuntime,
  ApiError,
  Message,
  Run,
  SessionMeta,
  TokenUsage,
  ToolCall,
  ToolCallRecord,
  WorkspaceContext,
  SupportedLocale,
} from '@finagent/core';
import type { RunRepository } from '../storage/index.ts';
import type { SessionManager } from './session-manager.ts';
import { createCodeError, isRuntimeInfraCode, toApiError } from '../agent/errors.ts';
import {
  addUsage,
  budgetStop,
  checkBudget,
  createUsage,
  resolveBudget,
  type ResolveBudgetInput,
  type RunBudgetLimits,
  type RunBudgetUsage,
  type RunStop,
} from './run-budget.ts';
import {
  createRunawayState,
  observeSearchQuery,
  observeToolCall,
  runawayStop,
  toolPatternMatches,
  type RunawayPolicy,
  type RunawayState,
} from './runaway-detector.ts';
import { buildFinancialEvidence } from '../evidence/financial-evidence.ts';

export interface RunManagerTimer {
  cancel(): void;
}

export interface RunManagerScheduler {
  setTimeout(callback: () => void, delayMs: number): RunManagerTimer;
}

const DEFAULT_SCHEDULER: RunManagerScheduler = {
  setTimeout(callback, delayMs) {
    const handle = setTimeout(callback, delayMs);
    return { cancel: () => clearTimeout(handle) };
  },
};

export interface RunManagerOptions {
  sessions: SessionManager;
  runs: RunRepository;
  runtime: AgentRuntime;
  now?: () => number;
  /** Timer implementation for deterministic tests; production uses setTimeout. */
  scheduler?: RunManagerScheduler;
  /**
   * Budget defaults and the system ceiling applied to every run (#17). A run
   * may override the defaults but never the ceiling; with no `budgets` option a
   * run is unbudgeted and behaves exactly as before.
   */
  budgets?: ResolveBudgetInput;
  /** Tool-name patterns (`*` wildcard) whose `query` argument feeds the search-loop detector. */
  searchTools?: string[];
  /** Runaway detector thresholds; unset fields fall back to `defaultRunawayPolicy()`. */
  runaway?: Partial<RunawayPolicy>;
}

interface ActiveRun {
  sessionId: string;
  runId: string;
  cancelRequested: boolean;
  /** When the run started, for the wall-clock budget. */
  startedAt: number;
  /** Effective limits for this run, after defaults, overrides and the ceiling. */
  limits: RunBudgetLimits;
  usage: RunBudgetUsage;
  runaway: RunawayState;
  /** Set when a budget or a runaway detector stopped the run. */
  stop?: RunStop;
  /** Active wall-clock deadline; absent when the limit is unset or already cleared. */
  wallClockTimer?: RunManagerTimer;
}

/**
 * Starts, observes, persists, and terminates runs.
 *
 * Each run: persists the user message and the run record, drives the runtime's
 * event stream, broadcasts every AgentEvent to subscribers (the Electron main
 * process forwards them to the UI), persists the final assistant message and
 * run outcome, and guarantees the run never stays `running`: every terminal
 * path (completed, failed, cancelled, runtime crash, timeout) settles it.
 */
export class RunManager {
  private readonly sessions: SessionManager;
  private readonly runs: RunRepository;
  private readonly runtime: AgentRuntime;
  private readonly now: () => number;
  private readonly scheduler: RunManagerScheduler;
  private readonly budgetInput: ResolveBudgetInput;
  private readonly searchToolPatterns: readonly string[];
  private readonly runawayPolicy: Partial<RunawayPolicy>;
  private readonly listeners = new Set<(event: AgentEvent) => void>();
  private activeRun: ActiveRun | null = null;

  constructor(options: RunManagerOptions) {
    this.sessions = options.sessions;
    this.runs = options.runs;
    this.runtime = options.runtime;
    this.now = options.now ?? Date.now;
    this.scheduler = options.scheduler ?? DEFAULT_SCHEDULER;
    this.budgetInput = options.budgets ?? {};
    this.searchToolPatterns = options.searchTools ?? [];
    this.runawayPolicy = options.runaway ?? {};
  }

  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Whether a run is currently executing (Pi runtime executes one at a time). */
  isRunning(): boolean {
    return this.activeRun !== null;
  }

  /** Whether a run is currently executing for the given session. */
  hasActiveRun(sessionId: string): boolean {
    return this.activeRun?.sessionId === sessionId;
  }

  /**
   * Start a run and drive it to a terminal state.
   * @param sessionId - the session the run belongs to.
   * @param content - the user message.
   * @param workspaceContext - optional workspace context for the runtime.
   * @param locale - optional UI locale.
   * @param budgetOverrides - per-run budget overrides, clamped by the system ceiling.
   * @returns the persisted running run.
   */
  async startRun(
    sessionId: string,
    content: string,
    workspaceContext?: WorkspaceContext,
    locale?: SupportedLocale,
    budgetOverrides?: RunBudgetLimits
  ): Promise<Run> {
    const text = content.trim();
    if (!text) {
      throw createCodeError('INVALID_ARGUMENT', 'Message content is required.');
    }
    if (this.activeRun) {
      throw createCodeError(
        'RUN_IN_PROGRESS',
        'Another run is still in progress. Stop it before sending a new message.'
      );
    }

    const session = await this.sessions.getSession(sessionId);
    if (!session) {
      throw createCodeError('SESSION_NOT_FOUND', `Session ${sessionId} was not found.`);
    }

    const now = this.now();
    const run: Run = {
      id: randomUUID(),
      sessionId,
      status: 'running',
      input: text,
      startedAt: now,
    };
    await this.runs.create(run);

    const userMessage: Message = {
      id: randomUUID(),
      role: 'user',
      content: text,
      timestamp: now,
    };
    await this.sessions.appendMessage(sessionId, userMessage);
    await this.sessions.updateSession(sessionId, { status: 'running' });

    const { limits } = resolveBudget({
      defaults: this.budgetInput.defaults,
      ceiling: this.budgetInput.ceiling,
      overrides: budgetOverrides,
    });
    const active: ActiveRun = {
      sessionId,
      runId: run.id,
      cancelRequested: false,
      startedAt: now,
      limits,
      usage: createUsage(),
      runaway: createRunawayState(),
    };
    this.activeRun = active;
    this.armWallClockBudget(active);
    this.emit({
      id: randomUUID(),
      sessionId,
      runId: run.id,
      type: 'run_started',
      timestamp: now,
      sequence: 1,
      payload: { run, userMessage },
    });

    void this.execute(run, session, workspaceContext, locale);
    return run;
  }

  /** Abort the given run if it is the one currently executing. */
  async cancelRun(sessionId: string, runId: string): Promise<void> {
    const active = this.activeRun;
    if (!active || active.sessionId !== sessionId || active.runId !== runId) {
      return;
    }
    active.cancelRequested = true;
    this.clearWallClockTimer(active);
    await this.runtime.cancel({ sessionId, runId });
  }

  private async execute(
    run: Run,
    session: SessionMeta,
    workspaceContext?: WorkspaceContext,
    locale?: SupportedLocale
  ): Promise<void> {
    let failure: ApiError | undefined;
    let answer = '';
    const toolCalls: ToolCall[] = [];
    let sawTerminal = false;

    try {
      await this.runtime.ensureSession({
        id: run.sessionId,
        title: session.title,
        sessionPath: session.runtimeSessionPath,
        recentSymbols: session.recentSymbols,
      });

      // A wall-clock deadline can expire while ensureSession is still pending.
      // Never start a runtime run that was already cancelled before it began.
      if (!this.activeRun?.cancelRequested) {
        for await (const event of this.runtime.run({
          sessionId: run.sessionId,
          runId: run.id,
          content: run.input,
          workspaceContext,
          locale,
        })) {
          this.emit(event);
          if (event.type === 'message_delta' || event.type === 'message_completed') {
            answer = event.payload.answer;
          } else if (event.type === 'tool_completed') {
            toolCalls.push(event.payload.toolCall);
          } else if (event.type === 'run_failed') {
            failure = event.payload.error;
            sawTerminal = true;
          } else if (event.type === 'run_completed') {
            answer = event.payload.answer;
            sawTerminal = true;
          }

          // Budgets and detectors are evaluated after the event is accounted for,
          // so a run that stops keeps the evidence it had already produced.
          if (await this.applyBudget(event)) break;
        }
      }
    } catch (error) {
      failure = toApiError(error);
    }

    const active = this.activeRun;
    const cancelRequested = active?.cancelRequested ?? false;
    const stop = active?.stop;
    if (stop !== undefined) {
      run.stopReason = stop.stopReason;
      run.stopDetail = stop.detail;
    }

    const now = this.now();
    const cancelled = Boolean(cancelRequested || (failure && failure.code === 'RUN_CANCELLED'));

    if (cancelled) {
      run.status = 'cancelled';
      run.answer = answer;
    } else if (failure) {
      run.status = 'failed';
      run.error = failure;
      run.answer = answer;
    } else {
      run.status = 'completed';
      run.answer = answer;
    }
    run.completedAt = now;

    await this.runs.update(run);

    // V8.1 §38–39: an *infrastructure* failure (Pi process failed to start /
    // stay up) is not an answer — do not persist an assistant-style message
    // that would spam the conversation. The renderer shows a dedicated banner
    // instead. Real failures (tool errors, task failures) keep the message.
    const isInfraFailure = run.status === 'failed' && isRuntimeInfraCode(run.error?.code);
    if (!isInfraFailure) {
      const assistantMessage: Message = {
        id: randomUUID(),
        role: 'assistant',
        content: answer || (run.status === 'failed' ? run.error?.message ?? 'Run failed.' : ''),
        timestamp: now,
        toolCalls: toolCalls.map(toRecord),
        financialEvidence: buildFinancialEvidence({
          sessionId: run.sessionId,
          runId: run.id,
          toolCalls,
        }),
      };
      await this.sessions.appendMessage(run.sessionId, assistantMessage);
    }
    await this.sessions.updateSession(run.sessionId, {
      status: 'idle',
      recentSymbols: collectSymbols(toolCalls),
    });

    if (active) this.clearWallClockTimer(active);

    // The run is fully settled (persisted) only now; only then allow the next run.
    this.activeRun = null;

    // Adapters emit the terminal event themselves; synthesize it only when the
    // stream failed before producing one (e.g. runtime spawn failure), so the
    // UI always observes a terminal event.
    if (!sawTerminal) {
      if (stop !== undefined) {
        this.emitRunEvent(run, 'run_failed', { error: stopError(stop) });
      } else if (cancelled) {
        this.emitRunEvent(run, 'run_failed', {
          error: { code: 'RUN_CANCELLED', message: 'Run cancelled by user.' },
        });
      } else if (failure) {
        this.emitRunEvent(run, 'run_failed', { error: failure });
      } else {
        this.emitRunEvent(run, 'run_completed', { answer, toolCalls });
      }
    }
  }

  /**
   * Account for one runtime event and decide whether the run must stop. A stop
   * requests cancellation, so the caller stops consuming events and the run
   * settles as `cancelled` — never as an ordinary success — carrying its partial
   * answer, its tool calls and the machine-readable reason it stopped.
   * @param event - the event that was just broadcast.
   * @returns true when the run was stopped and cancellation was requested.
   */
  private async applyBudget(event: AgentEvent): Promise<boolean> {
    const active = this.activeRun;
    if (!active) return false;

    let usage = active.usage;
    if (event.type === 'message_completed') {
      usage = addUsage(usage, { modelCalls: 1 });
      usage = addUsage(usage, reportedUsageDelta(event.payload.usage));
    }
    if (event.type === 'tool_completed') usage = addUsage(usage, { toolCalls: 1 });

    const searchQuery =
      event.type === 'tool_completed' ? this.searchQueryOf(event.payload.toolCall) : undefined;
    if (searchQuery !== undefined) usage = addUsage(usage, { searchIterations: 1 });

    // Wall-clock is absolute: recomputed from the run's start on every event.
    active.usage = { ...usage, wallClockMs: this.now() - active.startedAt };

    let stop: RunStop | undefined;
    const exhaustion = checkBudget(active.limits, active.usage);
    if (exhaustion !== undefined) {
      stop = budgetStop(exhaustion);
    } else if (event.type === 'tool_completed') {
      const call = observeToolCall(
        active.runaway,
        { tool: event.payload.toolCall.toolName, args: event.payload.toolCall.args },
        this.runawayPolicy
      );
      active.runaway = call.state;
      if (call.detection.detected) stop = runawayStop(call.detection);
    }

    if (stop === undefined && searchQuery !== undefined) {
      const search = observeSearchQuery(active.runaway, searchQuery, this.runawayPolicy);
      active.runaway = search.state;
      if (search.detection.detected) stop = runawayStop(search.detection);
    }

    if (stop === undefined) return false;
    return this.requestSafeguardStop(stop);
  }

  /** Schedule the wall-clock safeguard for one active run. */
  private armWallClockBudget(active: ActiveRun): void {
    const limit = active.limits.wallClockMs;
    if (limit === undefined) return;

    active.wallClockTimer = this.scheduler.setTimeout(() => {
      void this.handleWallClockExpiry(active.runId).catch(() => undefined);
    }, limit);
  }

  /** Stop once from a timer callback, even if the callback is accidentally fired twice. */
  private async handleWallClockExpiry(runId: string): Promise<void> {
    const active = this.activeRun;
    if (!active || active.runId !== runId) return;

    const limit = active.limits.wallClockMs;
    if (limit === undefined) return;

    const used = Math.max(this.now() - active.startedAt, limit);
    active.usage = { ...active.usage, wallClockMs: used };
    await this.requestSafeguardStop(budgetStop({ key: 'wallClockMs', limit, used }));
  }

  /**
   * Shared idempotent stop path for event-driven budgets and timer deadlines.
   * The first caller owns cancellation; later callers are no-ops.
   */
  private async requestSafeguardStop(stop: RunStop): Promise<boolean> {
    const active = this.activeRun;
    if (!active || active.stop !== undefined || active.cancelRequested) return false;

    active.stop = stop;
    active.cancelRequested = true;
    this.clearWallClockTimer(active);
    await this.runtime.cancel({ sessionId: active.sessionId, runId: active.runId });
    return true;
  }

  private clearWallClockTimer(active: ActiveRun): void {
    active.wallClockTimer?.cancel();
    active.wallClockTimer = undefined;
  }

  /**
   * The query a search-tool call carries, when this run tracks search loops.
   * @param toolCall - the completed tool call.
   * @returns the query text, or undefined when the call is not a tracked search.
   */
  private searchQueryOf(toolCall: ToolCall): string | undefined {
    if (this.searchToolPatterns.length === 0) return undefined;
    if (!this.searchToolPatterns.some((pattern) => toolPatternMatches(pattern, toolCall.toolName))) {
      return undefined;
    }
    const query = toolCall.args.query ?? toolCall.args.q;
    return typeof query === 'string' && query.trim() !== '' ? query : undefined;
  }

  private emitRunEvent(run: Run, type: AgentEvent['type'], payload?: AgentEventPayload): void {
    // Callers pair `type` with the matching payload shape.
    const event = {
      id: randomUUID(),
      sessionId: run.sessionId,
      runId: run.id,
      type,
      timestamp: this.now(),
      sequence: 1,
      payload,
    } as AgentEvent;
    this.emit(event);
  }

  private emit(event: AgentEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

/**
 * The error a budget or runaway stop reports to the UI. The code is stable so
 * the renderer can tell a budget stop from a user cancel, and the detail keeps
 * the numbers (which budget, which loop) attached to the message.
 * @param stop - the stop recorded on the run.
 * @returns an ApiError describing why the run stopped.
 */
/**
 * The budget delta a provider-reported usage contributes. Values that are
 * missing or unusable are skipped on purpose: a provider that cannot report
 * tokens or cost must not fail an otherwise normal run (#17 acceptance).
 * @param usage - usage the runtime attached to a completed message.
 * @returns the delta to add to the run's usage.
 */
function reportedUsageDelta(usage: TokenUsage | undefined): Partial<RunBudgetUsage> {
  if (usage === undefined) return {};
  const delta: Partial<RunBudgetUsage> = {};
  if (isNonNegative(usage.inputTokens)) delta.inputTokens = usage.inputTokens;
  if (isNonNegative(usage.outputTokens)) delta.outputTokens = usage.outputTokens;
  if (usage.costUsd !== undefined && isNonNegative(usage.costUsd)) delta.costUsd = usage.costUsd;
  return delta;
}

function isNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function stopError(stop: RunStop): ApiError {
  const code =
    stop.stopReason === 'budget_exhausted'
      ? 'BUDGET_EXHAUSTED'
      : stop.stopReason === 'retry_storm'
        ? 'RETRY_STORM'
        : 'LOOP_DETECTED';
  const detail = stop.detail === undefined ? '' : ` ${JSON.stringify(stop.detail)}`;
  return { code, message: `Run stopped: ${stop.stopReason}.${detail}` };
}

function toRecord(toolCall: ToolCall): ToolCallRecord {
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

function collectSymbols(toolCalls: ToolCall[]): string[] {
  const symbols: string[] = [];
  for (const toolCall of toolCalls) {
    const symbol = typeof toolCall.args.symbol === 'string' ? toolCall.args.symbol.toUpperCase() : undefined;
    if (symbol && !symbols.includes(symbol)) {
      symbols.push(symbol);
    }
  }
  return symbols.slice(0, 5);
}
