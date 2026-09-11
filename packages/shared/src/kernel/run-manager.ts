import { randomUUID } from 'node:crypto';
import type {
  AgentEvent,
  AgentEventPayload,
  AgentRuntime,
  ApiError,
  ConversationBranch,
  ConversationOperation,
  Message,
  Run,
  RunContextSnapshot,
  RuntimeRunArtifacts,
  SessionMeta,
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

export interface RunManagerOptions {
  sessions: SessionManager;
  runs: RunRepository;
  runtime: AgentRuntime;
  now?: () => number;
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
}

interface GenerationOptions {
  session: SessionMeta;
  branch: ConversationBranch;
  content: string;
  operation: ConversationOperation;
  sourceMessageId?: string;
  parentRunId?: string;
  parentMessageId?: string;
  existingUserMessage?: Message;
  workspaceContext?: WorkspaceContext;
  locale?: SupportedLocale;
  budgetOverrides?: RunBudgetLimits;
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
    this.assertNoActiveRun();
    const session = await this.sessions.getSession(sessionId);
    if (!session) {
      throw createCodeError('SESSION_NOT_FOUND', `Session ${sessionId} was not found.`);
    }
    const branch = await this.sessions.getActiveBranch(sessionId);
    if (!branch) {
      throw createCodeError('BRANCH_NOT_FOUND', `The active branch for session ${sessionId} was not found.`);
    }
    const visibleMessages = await this.sessions.listMessages(sessionId, branch.id);
    return this.startGeneration({
      session,
      branch,
      content: text,
      operation: 'send',
      parentMessageId: visibleMessages.at(-1)?.id,
      workspaceContext,
      locale,
      budgetOverrides,
    });
  }

  /** Retry a failed/cancelled generation on a new child branch. */
  async retryRun(
    sessionId: string,
    runId: string,
    workspaceContext?: WorkspaceContext,
    locale?: SupportedLocale
  ): Promise<Run> {
    this.assertNoActiveRun();
    const sourceRun = await this.sessions.getRun(sessionId, runId);
    if (!sourceRun) throw createCodeError('RUN_NOT_FOUND', `Run ${runId} was not found.`);
    if (sourceRun.status !== 'failed' && sourceRun.status !== 'cancelled') {
      throw createCodeError('INVALID_ARGUMENT', 'Only failed or cancelled runs can be retried.');
    }

    const sourceBranch = await this.branchForRun(sessionId, sourceRun);
    const visible = await this.sessions.listMessages(sessionId, sourceBranch.id);
    const userIndex = findUserMessageIndex(visible, sourceRun);
    const sourceUser = userIndex >= 0 ? visible[userIndex] : undefined;
    const runtimeForkEntryId = sourceRun.runtimeUserEntryId ??
      (sourceUser ? await this.runtimeForkEntryForMessage(sessionId, sourceUser) : undefined);
    const child = await this.createDerivedBranch(
      sessionId,
      sourceBranch,
      userIndex > 0 ? visible[userIndex - 1].id : null,
      `Retry · ${sourceRun.input.slice(0, 32)}`,
      runtimeForkEntryId
    );
    const session = await this.requireSession(sessionId);
    return this.startGeneration({
      session,
      branch: child,
      content: sourceRun.input,
      operation: 'retry',
      sourceMessageId: sourceUser?.id,
      parentRunId: sourceRun.id,
      parentMessageId: userIndex > 0 ? visible[userIndex - 1].id : undefined,
      workspaceContext,
      locale,
    });
  }

  /** Regenerate an assistant artifact while inheriting the same user context. */
  async regenerateMessage(
    sessionId: string,
    assistantMessageId: string,
    workspaceContext?: WorkspaceContext,
    locale?: SupportedLocale
  ): Promise<Run> {
    this.assertNoActiveRun();
    const sourceBranch = await this.sessions.getActiveBranch(sessionId);
    if (!sourceBranch) throw createCodeError('BRANCH_NOT_FOUND', 'The active branch was not found.');
    const visible = await this.sessions.listMessages(sessionId, sourceBranch.id);
    const assistant = visible.find((message) => message.id === assistantMessageId);
    if (!assistant || assistant.role !== 'assistant') {
      throw createCodeError('MESSAGE_NOT_FOUND', `Assistant message ${assistantMessageId} was not found.`);
    }
    const sourceRun = assistant.runId ? await this.sessions.getRun(sessionId, assistant.runId) : null;
    if (!sourceRun) {
      throw createCodeError('RUN_NOT_FOUND', `The generation for message ${assistantMessageId} was not found.`);
    }
    const userMessage = sourceRun.userMessageId
      ? visible.find((message) => message.id === sourceRun.userMessageId)
      : findPreviousUserMessage(visible, visible.indexOf(assistant));
    if (!userMessage) {
      throw createCodeError('MESSAGE_NOT_FOUND', 'The user context for this answer was not found.');
    }
    const runtimeForkEntryId = sourceRun.runtimeUserEntryId ??
      await this.runtimeForkEntryForMessage(sessionId, userMessage);
    const child = await this.createDerivedBranch(
      sessionId,
      sourceBranch,
      userMessage.id,
      `Regenerate · ${userMessage.content.slice(0, 28)}`,
      runtimeForkEntryId
    );
    const session = await this.requireSession(sessionId);
    return this.startGeneration({
      session,
      branch: child,
      content: userMessage.content,
      operation: 'regenerate',
      sourceMessageId: assistant.id,
      parentRunId: sourceRun.id,
      parentMessageId: userMessage.id,
      existingUserMessage: userMessage,
      workspaceContext,
      locale,
    });
  }

  /** Edit a historical user message and rerun from the preceding cursor. */
  async editMessage(
    sessionId: string,
    userMessageId: string,
    content: string,
    workspaceContext?: WorkspaceContext,
    locale?: SupportedLocale
  ): Promise<Run> {
    this.assertNoActiveRun();
    const text = content.trim();
    if (!text) throw createCodeError('INVALID_ARGUMENT', 'Message content is required.');
    const sourceBranch = await this.sessions.getActiveBranch(sessionId);
    if (!sourceBranch) throw createCodeError('BRANCH_NOT_FOUND', 'The active branch was not found.');
    const visible = await this.sessions.listMessages(sessionId, sourceBranch.id);
    const sourceIndex = visible.findIndex((message) => message.id === userMessageId);
    const sourceMessage = sourceIndex >= 0 ? visible[sourceIndex] : undefined;
    if (!sourceMessage || sourceMessage.role !== 'user') {
      throw createCodeError('MESSAGE_NOT_FOUND', `User message ${userMessageId} was not found.`);
    }
    const runtimeForkEntryId = await this.runtimeForkEntryForMessage(sessionId, sourceMessage);
    const child = await this.createDerivedBranch(
      sessionId,
      sourceBranch,
      sourceIndex > 0 ? visible[sourceIndex - 1].id : null,
      `Edit · ${text.slice(0, 32)}`,
      runtimeForkEntryId
    );
    const session = await this.requireSession(sessionId);
    return this.startGeneration({
      session,
      branch: child,
      content: text,
      operation: 'edit',
      sourceMessageId: sourceMessage.id,
      parentMessageId: sourceIndex > 0 ? visible[sourceIndex - 1].id : undefined,
      workspaceContext,
      locale,
    });
  }

  /** Create and activate a branch from an earlier visible message. */
  async forkBranch(sessionId: string, messageId: string, name?: string): Promise<ConversationBranch> {
    this.assertNoActiveRun();
    const sourceBranch = await this.sessions.getActiveBranch(sessionId);
    if (!sourceBranch) throw createCodeError('BRANCH_NOT_FOUND', 'The active branch was not found.');
    const visible = await this.sessions.listMessages(sessionId, sourceBranch.id);
    if (!visible.some((message) => message.id === messageId)) {
      throw createCodeError('MESSAGE_NOT_FOUND', `Message ${messageId} was not found.`);
    }
    const sourceMessage = visible.find((message) => message.id === messageId);
    const runtimeForkEntryId = sourceMessage
      ? await this.runtimeForkEntryForMessage(sessionId, sourceMessage)
      : undefined;
    const child = await this.createDerivedBranch(
      sessionId,
      sourceBranch,
      messageId,
      name?.trim() || `Fork · ${new Date(this.now()).toISOString()}`,
      runtimeForkEntryId
    );
    await this.sessions.setActiveBranch(sessionId, child.id);
    return child;
  }

  async setActiveBranch(sessionId: string, branchId: string): Promise<ConversationBranch> {
    this.assertNoActiveRun();
    const branch = await this.sessions.setActiveBranch(sessionId, branchId);
    if (!branch) throw createCodeError('BRANCH_NOT_FOUND', `Branch ${branchId} was not found.`);
    return branch;
  }

  /** Abort the given run if it is the one currently executing. */
  async cancelRun(sessionId: string, runId: string): Promise<void> {
    const active = this.activeRun;
    if (!active || active.sessionId !== sessionId || active.runId !== runId) {
      return;
    }
    active.cancelRequested = true;
    await this.runtime.cancel({ sessionId, runId });
  }

  private async startGeneration(options: GenerationOptions): Promise<Run> {
    const text = options.content.trim();
    if (!text) throw createCodeError('INVALID_ARGUMENT', 'Message content is required.');
    if (this.activeRun) {
      throw createCodeError(
        'RUN_IN_PROGRESS',
        'Another run is still in progress. Stop it before sending a new message.'
      );
    }

    const now = this.now();
    const runId = randomUUID();
    const contextSnapshot: RunContextSnapshot = {
      capturedAt: now,
      workspaceContext: options.workspaceContext,
      recentSymbols: options.session.recentSymbols ? [...options.session.recentSymbols] : undefined,
    };
    const userMessage = options.existingUserMessage ?? {
      id: randomUUID(),
      role: 'user' as const,
      content: text,
      timestamp: now,
      branchId: options.branch.id,
      parentMessageId: options.parentMessageId,
      runId,
      generationId: runId,
      operation: options.operation,
      sourceMessageId: options.sourceMessageId,
      contextSnapshot,
    };
    const run: Run = {
      id: runId,
      sessionId: options.session.id,
      status: 'running',
      input: text,
      startedAt: now,
      branchId: options.branch.id,
      operation: options.operation,
      parentRunId: options.parentRunId,
      sourceMessageId: options.sourceMessageId,
      userMessageId: userMessage.id,
      generationId: runId,
      contextSnapshot,
      manifest: {
        runId,
        branchId: options.branch.id,
        operation: options.operation,
        inputMessageId: userMessage.id,
        parentRunId: options.parentRunId,
        sourceMessageId: options.sourceMessageId,
        contextSnapshot,
        toolCallIds: [],
      },
    };

    await this.runs.create(run);
    if (!options.existingUserMessage) {
      await this.sessions.appendMessage(options.session.id, userMessage);
    }
    await this.sessions.updateSession(options.session.id, { status: 'running' });

    const { limits } = resolveBudget({
      defaults: this.budgetInput.defaults,
      ceiling: this.budgetInput.ceiling,
      overrides: options.budgetOverrides,
    });
    this.activeRun = {
      sessionId: options.session.id,
      runId: run.id,
      cancelRequested: false,
      startedAt: now,
      limits,
      usage: createUsage(),
      runaway: createRunawayState(),
    };
    this.emit({
      id: randomUUID(),
      sessionId: options.session.id,
      runId: run.id,
      type: 'run_started',
      timestamp: now,
      sequence: 1,
      payload: {
        run,
        userMessage,
        userMessageIsNew: !options.existingUserMessage,
      },
    });

    void this.execute(run, options.session, options.workspaceContext, options.locale);
    return run;
  }

  private assertNoActiveRun(): void {
    if (this.activeRun) {
      throw createCodeError(
        'RUN_IN_PROGRESS',
        'Another run is still in progress. Stop it before changing conversation branches.'
      );
    }
  }

  private async requireSession(sessionId: string): Promise<SessionMeta> {
    const session = await this.sessions.getSession(sessionId);
    if (!session) throw createCodeError('SESSION_NOT_FOUND', `Session ${sessionId} was not found.`);
    return session;
  }

  private async branchForRun(sessionId: string, run: Run): Promise<ConversationBranch> {
    const branch = run.branchId
      ? await this.sessions.getBranch(sessionId, run.branchId)
      : await this.sessions.getActiveBranch(sessionId);
    if (!branch) throw createCodeError('BRANCH_NOT_FOUND', 'The source branch was not found.');
    return branch;
  }

  /** Resolve the native Pi user-entry cursor for a Folio message. */
  private async runtimeForkEntryForMessage(sessionId: string, message: Message): Promise<string | undefined> {
    const run = message.runId ? await this.sessions.getRun(sessionId, message.runId) : null;
    if (message.role === 'user') {
      return run?.runtimeUserEntryId ?? message.runtimeEntryId;
    }
    // Pi forks before a user entry. When the UI forks from an assistant
    // artifact, use the user generation that produced that artifact.
    if (message.role === 'assistant') {
      return run?.runtimeUserEntryId;
    }
    return message.runtimeEntryId;
  }

  private async createDerivedBranch(
    sessionId: string,
    parent: ConversationBranch,
    forkMessageId: string | null | undefined,
    name: string,
    runtimeForkEntryId?: string
  ): Promise<ConversationBranch> {
    const child = await this.sessions.createBranch({
      sessionId,
      name,
      parentBranchId: parent.id,
      forkMessageId,
      runtimeForkEntryId,
    });
    await this.sessions.setActiveBranch(sessionId, child.id);
    return child;
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
      let branch = run.branchId
        ? await this.sessions.getBranch(run.sessionId, run.branchId)
        : null;
      let runtimeSessionPath = branch?.runtimeSessionPath ?? session.runtimeSessionPath;

      if (branch?.parentBranchId && !branch.runtimeSessionPath && this.runtime.prepareBranch) {
        const parent = await this.sessions.getBranch(run.sessionId, branch.parentBranchId);
        const prepared = await this.runtime.prepareBranch({
          sessionId: run.sessionId,
          branchId: branch.id,
          parentBranchId: branch.parentBranchId,
          parentSessionPath: parent?.runtimeSessionPath ?? session.runtimeSessionPath,
          forkMessageId: branch.forkMessageId,
          forkRuntimeEntryId: branch.runtimeForkEntryId,
        });
        branch = await this.sessions.updateBranch(run.sessionId, branch.id, {
          runtimeLeafId: prepared.runtimeLeafId,
          runtimeSessionPath: prepared.runtimeSessionPath,
        });
        runtimeSessionPath = prepared.runtimeSessionPath ?? runtimeSessionPath;
      }

      await this.runtime.ensureSession({
        id: run.sessionId,
        title: session.title,
        branchId: run.branchId,
        sessionPath: runtimeSessionPath,
        recentSymbols: session.recentSymbols,
      });

      for await (const event of this.runtime.run({
        sessionId: run.sessionId,
        runId: run.id,
        content: run.input,
        branchId: run.branchId,
        sessionPath: runtimeSessionPath,
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

    let runtimeArtifacts: RuntimeRunArtifacts | undefined;
    if (this.runtime.getRunArtifacts) {
      try {
        runtimeArtifacts = await this.runtime.getRunArtifacts({ sessionId: run.sessionId, runId: run.id });
      } catch {
        // Runtime diagnostics must never turn an already-settled generation
        // into a second failure.
      }
    }

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
    if (runtimeArtifacts) {
      run.runtimeSessionId = runtimeArtifacts.runtimeSessionId;
      run.runtimeSessionPath = runtimeArtifacts.runtimeSessionPath;
      run.runtimeLeafId = runtimeArtifacts.runtimeLeafId;
      run.runtimeUserEntryId = runtimeArtifacts.runtimeUserEntryId;
      run.runtimeAssistantEntryId = runtimeArtifacts.runtimeAssistantEntryId;
      if (run.branchId) {
        await this.sessions.updateBranch(run.sessionId, run.branchId, {
          runtimeLeafId: runtimeArtifacts.runtimeLeafId,
          runtimeSessionPath: runtimeArtifacts.runtimeSessionPath,
        });
      }
    }
    if (run.manifest) {
      run.manifest = {
        ...run.manifest,
        toolCallIds: toolCalls.map((toolCall) => toolCall.id),
        runtimeSessionId: run.runtimeSessionId,
        runtimeSessionPath: run.runtimeSessionPath,
        runtimeLeafId: run.runtimeLeafId,
        runtimeUserEntryId: run.runtimeUserEntryId,
        runtimeAssistantEntryId: run.runtimeAssistantEntryId,
      };
    }

    await this.runs.update(run);

    // V8.1 §38–39: an *infrastructure* failure (Pi process failed to start /
    // stay up) is not an answer — do not persist an assistant-style message
    // that would spam the conversation. The renderer shows a dedicated banner
    // instead. Real failures (tool errors, task failures) keep the message.
    const isInfraFailure = run.status === 'failed' && isRuntimeInfraCode(run.error?.code);
    if (!isInfraFailure) {
      const assistantMessage: Message = {
        // The run id gives the assistant artifact a deterministic stable id
        // across the live event projection and a subsequent reload.
        id: `assistant-${run.id}`,
        role: 'assistant',
        content: answer || (run.status === 'failed' ? run.error?.message ?? 'Run failed.' : ''),
        timestamp: now,
        toolCalls: toolCalls.map(toRecord),
        branchId: run.branchId,
        parentMessageId: run.userMessageId,
        runId: run.id,
        generationId: run.generationId ?? run.id,
        operation: run.operation,
        sourceMessageId: run.sourceMessageId,
        contextSnapshot: run.contextSnapshot,
        runtimeEntryId: run.runtimeAssistantEntryId,
      };
      await this.sessions.appendMessage(run.sessionId, assistantMessage);
    }
    await this.sessions.updateSession(run.sessionId, {
      status: 'idle',
      recentSymbols: collectSymbols(toolCalls),
    });

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
    if (event.type === 'message_completed') usage = addUsage(usage, { modelCalls: 1 });
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

    active.stop = stop;
    active.cancelRequested = true;
    await this.runtime.cancel({ sessionId: active.sessionId, runId: active.runId });
    return true;
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

function findUserMessageIndex(messages: Message[], run: Run): number {
  if (run.userMessageId) {
    const exact = messages.findIndex((message) => message.id === run.userMessageId);
    if (exact >= 0) return exact;
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user' && messages[index].content === run.input) return index;
  }
  return -1;
}

function findPreviousUserMessage(messages: Message[], beforeIndex: number): Message | undefined {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') return messages[index];
  }
  return undefined;
}
