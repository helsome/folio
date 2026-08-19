import { homedir } from 'node:os';
import { join } from 'node:path';
import { unlink } from 'node:fs/promises';
import type {
  AgentEvent,
  AgentRunInput,
  AgentRuntime,
  ApiError,
  ApiResult,
  LlmModel,
  LlmRuntimeState,
  LlmTestResult,
  RuntimeSession,
  SkillReadiness,
  ToolCall,
  ToolDefinition,
  WorkspaceContext,
  SupportedLocale,
} from '@finagent/core';
import type { SkillHub } from '@finagent/skill-hub';
import { FinanceToolRegistry } from './finance-tool-registry.ts';
import { createPhaseOneRegistry } from '../capabilities/index.ts';
import { MarketDataService } from './market-data-service.ts';
import { PiRpcClient, type PiRpcClientOptions, type PiState } from './pi-rpc-client.ts';
import { PiEventAdapter } from './pi-event-adapter.ts';
import { createCodeError, toApiError } from './errors.ts';

/** Response-language names fed to the Pi runtime (English instruction). */
const RUNTIME_LOCALE_NAMES: Record<SupportedLocale, string> = {
  'zh-CN': 'Simplified Chinese',
  'en-US': 'English',
};

export interface PiRuntimeAdapterOptions {
  registry?: FinanceToolRegistry;
  marketData?: MarketDataService;
  rpcClient?: PiRpcClient;
  rpc?: PiRpcClientOptions;
  /** Directory holding one JSONL session file per Folio session. */
  sessionDir?: string;
  /** Skill hub used to build the progressive skill index in the system prompt. */
  skillHub?: SkillHub;
  /**
   * Optional per-skill readiness resolver used to annotate each skill in the
   * index with its readiness status. Returns undefined when readiness is
   * unknown (e.g. the capability registry is unavailable), which omits the
   * readiness line. Defaults to undefined (annotation disabled).
   */
  readinessProvider?: (skillId: string) => SkillReadiness | undefined;
  now?: () => number;
}

/** LLM control surface exposed to the main process (and the UI via IPC). */
export interface LlmRuntimeApi {
  getState(): Promise<LlmRuntimeState>;
  listModels(): Promise<LlmModel[]>;
  setModel(provider: string, modelId: string): Promise<LlmRuntimeState>;
  listThinkingLevels(): Promise<string[]>;
  setThinkingLevel(level: string): Promise<LlmRuntimeState>;
  restart(): Promise<void>;
  testProvider(provider: string, modelId: string): Promise<LlmTestResult>;
}

interface RuntimeSessionState {
  sessionId: string;
  sessionPath: string;
  runtimeSessionId?: string;
  recentSymbols: string[];
}

const DEFAULT_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

/**
 * Pi runtime adapter: maps Folio sessions to Pi JSONL session files and turns
 * the raw Pi event stream into Folio AgentEvents.
 *
 * One Pi process is shared; session isolation comes from per-session session
 * files (`switch_session`), so each Folio session keeps its own conversation
 * that survives app restarts.
 */
export class PiRuntimeAdapter implements AgentRuntime {
  private readonly registry: FinanceToolRegistry;
  private readonly rpcClient: PiRpcClient;
  private readonly sessionDir: string;
  private readonly skillHub?: SkillHub;
  private readonly readinessProvider?: (skillId: string) => SkillReadiness | undefined;
  private readonly now: () => number;
  private readonly sessions = new Map<string, RuntimeSessionState>();
  /** Active session file in the runtime. */
  private activePath: string | null = null;
  /** Last configured Pi extension list + the Finagent-core-only subset. */
  private extensions: string[] = [];
  private coreExtensions: string[] = [];
  /** True once optional extensions were dropped for reliability (Diagnostics). */
  private degraded = false;
  /** Cache of the last known runtime state (model/thinking level). */
  private cachedState: LlmRuntimeState | null = null;

  constructor(options: PiRuntimeAdapterOptions = {}) {
    const marketData = options.marketData ?? new MarketDataService();
    this.registry = options.registry ?? new FinanceToolRegistry(createPhaseOneRegistry(marketData));
    this.rpcClient = options.rpcClient ?? new PiRpcClient(options.rpc);
    this.sessionDir = options.sessionDir ?? join(homedir(), '.finagent', 'pi-sessions');
    this.skillHub = options.skillHub;
    this.readinessProvider = options.readinessProvider;
    this.now = options.now ?? Date.now;
  }

  async getTools(): Promise<ApiResult<ToolDefinition[]>> {
    return { ok: true, data: this.registry.getTools() };
  }

  /**
   * Set the Pi extension list for future spawns (V7 multi-extension). The
   * main process applies this before restarting the runtime when tracing
   * configuration changes.
   */
  setExtensions(extensions: string[]): void {
    this.extensions = extensions;
    // The Finagent extension is the first entry (V7 listBundledPiExtensions);
    // everything after it is an optional observability extension. On failure
    // this slice is what the retry degrades to (V8.1 §37).
    this.coreExtensions = extensions.slice(0, 1).filter(Boolean);
    this.rpcClient.updateExtensions(extensions);
  }

  /** LLM control surface for the main process / settings UI. */
  getLlmApi(): LlmRuntimeApi {
    return {
      getState: () => this.getLlmState(),
      listModels: () => this.rpcClient.getAvailableModels(),
      setModel: (provider, modelId) => this.applySetModel(provider, modelId),
      listThinkingLevels: () => this.listThinkingLevels(),
      setThinkingLevel: (level) => this.applySetThinkingLevel(level),
      restart: () => this.rpcClient.restart(),
      testProvider: (provider, modelId) => this.testProvider(provider, modelId),
    };
  }

  async ensureSession(session: { id: string; title?: string; sessionPath?: string }): Promise<RuntimeSession> {
    const sessionPath = session.sessionPath ?? this.sessionPathFor(session.id);
    const state = this.getOrCreateState(session.id, sessionPath);
    await this.activate(state);
    return {
      sessionId: session.id,
      runtimeSessionId: state.runtimeSessionId,
      sessionPath,
      status: 'active',
    };
  }

  /** 
   * Run one prompt, with one retry at most. If the FIRST attempt dies at
   * startup with an optional-extension load failure (V8.1 §37), the retry
   * drops the optional extensions and respawns with the Finagent core only —
   * observability can never block agent execution. The failed attempt's
   * run_failed event is suppressed on the retry path so the conversation does
   * not see a spurious infrastructure error.
   */
  async *run(input: AgentRunInput): AsyncIterable<AgentEvent> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const outcome: { error: ApiError | undefined; terminated: boolean } = {
        error: undefined,
        terminated: false,
      };
      yield* this.runAttempt(input, outcome, /*yieldInfraFailure=*/ attempt > 0);
      if (outcome.terminated || attempt > 0) return;

      // First attempt ended without a terminal event → an infrastructure
      // startup failure attributable to an optional extension. Degrade once
      // to the Finagent core extension and retry this same prompt.
      this.rpcClient.updateExtensions(this.coreExtensions);
      await this.rpcClient.restart().catch(() => undefined);
      this.degraded = true;
    }
  }

  /** Whether optional extensions were dropped for reliability (Diagnostics). */
  isObservabilityDegraded(): boolean {
    return this.degraded;
  }

  /**
   * Sanitized Pi runtime facts for Diagnostics (V8.1 §40) — no secrets.
   * `llmState` is optional; when omitted provider/model stay null.
   */
  async getRuntimeDiagnostics(llmState?: LlmRuntimeState | null): Promise<{
    status: 'idle' | 'running' | 'exited' | 'unknown';
    command: string | null;
    cwd: string | null;
    extensions: string[];
    providersConfigured: string[];
    model: string | null;
    lastExitCode: number | null;
    lastExitSignal: string | null;
    stderrTail: string | null;
    observabilityDegraded: boolean;
  }> {
    const launch = this.rpcClient.getLaunchInfo();
    const exit = this.rpcClient.getLastExitInfo();
    const stderr = this.rpcClient.getRecentStderr();
    const model = llmState?.model ?? null;
    return {
      status: this.rpcClient.isRuntimeAlive() ? 'running' : exit ? 'exited' : 'idle',
      command: `${launch.command} ${launch.args.join(' ')}`.slice(0, 400),
      cwd: launch.cwd,
      extensions: launch.extensions,
      providersConfigured: model ? [model.provider] : [],
      model: model?.id ?? null,
      lastExitCode: exit?.code ?? null,
      lastExitSignal: exit?.signal ?? null,
      stderrTail: stderr.length > 0 ? stderr.slice(-2000) : null,
      observabilityDegraded: this.degraded,
    };
  }

  private async *runAttempt(
    input: AgentRunInput,
    outcome: { error: ApiError | undefined; terminated: boolean },
    yieldInfraFailure: boolean
  ): AsyncIterable<AgentEvent> {
    const state = this.getOrCreateState(input.sessionId, this.sessionPathFor(input.sessionId));
    const now = this.now;
    const fail = async function* (error: unknown, emit: boolean): AsyncIterable<AgentEvent> {
      outcome.error = toApiError(error);
      if (!emit) return;
      outcome.terminated = true;
      const adapter = new PiEventAdapter({ sessionId: input.sessionId, runId: input.runId, now });
      yield* adapter.fail(error);
    };

    try {
      await this.activate(state);
    } catch (error) {
      const emit = yieldInfraFailure || !(await this.isOptionalExtensionFailure(error));
      yield* fail(error, emit);
      return;
    }

    const adapter = new PiEventAdapter({ sessionId: input.sessionId, runId: input.runId, now: this.now });
    const stream = this.rpcClient.promptStreaming(
      buildPrompt(input.content, state, input.workspaceContext, this.skillHub, this.readinessProvider, input.locale)
    );
    let aborted = false;
    let runError: unknown;

    try {
      for await (const item of stream) {
        if (item.kind === 'event') {
          for (const event of adapter.consume(item.event)) {
            this.rememberSymbols(event);
            yield event;
          }
        } else if (item.kind === 'end') {
          aborted = item.result.aborted === true;
        }
      }
    } catch (error) {
      runError = error;
    }

    if (runError !== undefined) {
      const emitTerminal =
        yieldInfraFailure || !(await this.isOptionalExtensionFailure(runError));
      yield* fail(runError, emitTerminal);
      return;
    }

    outcome.terminated = true;
    if (aborted) {
      yield* adapter.cancelled();
    }
  }

  /** True when the error signature points at a broken optional-extension load. */
  private async isOptionalExtensionFailure(error: unknown): Promise<boolean> {
    if (this.extensions.length <= this.coreExtensions.length) return false;
    const code =
      error !== null && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code)
        : '';
    const isExitClass =
      code === 'PI_RUNTIME_EXITED' ||
      code === 'PI_RUNTIME_NOT_FOUND' ||
      code === 'PI_RUNTIME_ERROR' ||
      code === 'PI_RUNTIME_STOPPED';
    if (!isExitClass) return false;
    const stderr = await this.rpcDiagnosticsTail();
    return /Failed to load extension|Cannot find module|Error loading extension/i.test(stderr);
  }

  private async rpcDiagnosticsTail(): Promise<string> {
    return this.rpcClient.getRecentStderr();
  }

  async cancel(input: { sessionId: string; runId: string }): Promise<void> {
    await this.rpcClient.abortCurrentPrompt();
  }

  async disposeSession(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId);
    this.sessions.delete(sessionId);
    // Remove the Pi conversation file together with the Folio session. The
    // path is deterministic per session, so this works even when the session
    // was created but never ran.
    await unlink(join(this.sessionDir, `${sessionId}.jsonl`)).catch(() => undefined);
    if (state?.sessionPath && state.sessionPath !== join(this.sessionDir, `${sessionId}.jsonl`)) {
      await unlink(state.sessionPath).catch(() => undefined);
    }
    if (this.activePath === state?.sessionPath) {
      this.activePath = null;
    }
  }

  async dispose(): Promise<void> {
    await this.rpcClient.dispose();
  }

  /** Restart the runtime process (Diagnostics / settings). Best-effort. */
  async restart(): Promise<void> {
    await this.rpcClient.restart();
  }

  private sessionPathFor(sessionId: string): string {
    return join(this.sessionDir, `${sessionId}.jsonl`);
  }

  private getOrCreateState(sessionId: string, sessionPath: string): RuntimeSessionState {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;
    const state: RuntimeSessionState = { sessionId, sessionPath, recentSymbols: [] };
    this.sessions.set(sessionId, state);
    return state;
  }

  /** Ensure the Pi runtime has the session's conversation file loaded. */
  private async activate(state: RuntimeSessionState): Promise<void> {
    if (this.activePath === state.sessionPath && state.runtimeSessionId) {
      return;
    }
    const piState = await this.rpcClient.switchSession(state.sessionPath);
    state.runtimeSessionId = piState.sessionId;
    this.activePath = state.sessionPath;
  }

  private rememberSymbols(event: AgentEvent) {
    if (event.type !== 'tool_started' && event.type !== 'tool_completed') return;
    const toolCall = (event.payload as { toolCall: ToolCall }).toolCall;
    const symbol = typeof toolCall.args.symbol === 'string'
      ? toolCall.args.symbol.toUpperCase()
      : undefined;
    if (!symbol) return;
    const state = this.sessions.get(event.sessionId);
    if (!state) return;
    state.recentSymbols = [
      symbol,
      ...state.recentSymbols.filter((existing) => existing !== symbol),
    ].slice(0, 5);
  }

  // -------------------------------------------------------------------------
  // LLM control plane
  // -------------------------------------------------------------------------

  private async getLlmState(): Promise<LlmRuntimeState> {
    const piState = await this.rpcClient.getState();
    const state = toLlmRuntimeState(piState);
    this.cachedState = state;
    return state;
  }

  private async applySetModel(provider: string, modelId: string): Promise<LlmRuntimeState> {
    await this.rpcClient.setModel(provider, modelId);
    const state = await this.getLlmState();
    if (!state.model || state.model.provider !== provider || state.model.id !== modelId) {
      throw createCodeError(
        'PI_RUNTIME_ERROR',
        `Pi did not switch to ${provider}/${modelId}.`
      );
    }
    return state;
  }

  private async listThinkingLevels(): Promise<string[]> {
    const piState = await this.rpcClient.getState();
    const model = piState.model;
    const levelMap = model?.thinkingLevelMap;
    if (!levelMap || Object.keys(levelMap).length === 0) {
      return ['off', ...DEFAULT_THINKING_LEVELS.slice(1)];
    }
    const levels = Object.entries(levelMap)
      .filter(([, mapping]) => mapping !== null && mapping !== undefined)
      .map(([level]) => level);
    return ['off', ...levels];
  }

  private async applySetThinkingLevel(level: string): Promise<LlmRuntimeState> {
    await this.rpcClient.setThinkingLevel(level);
    return this.getLlmState();
  }

  /**
   * Minimal connection test: switch to a throwaway session file, run a
   * one-token prompt with the given model, then restore the active session.
   * Never touches finance tools.
   */
  private async testProvider(provider: string, modelId: string): Promise<LlmTestResult> {
    const startedAt = Date.now();
    const previousPath = this.activePath;
    const testSessionPath = join(this.sessionDir, `llm-test-${randomUUID().slice(0, 8)}.jsonl`);
    try {
      await this.rpcClient.switchSession(testSessionPath);
      const model = await this.rpcClient.setModel(provider, modelId);
      if (!model || model.provider !== provider || model.id !== modelId) {
        throw createCodeError('PI_RUNTIME_ERROR', `Model ${provider}/${modelId} is not available.`);
      }
      const result = await this.rpcClient.prompt('Reply with the single word OK.');
      return {
        ok: result.answer.trim().length > 0,
        message: 'Connection verified.',
        provider,
        modelId,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Connection test failed.',
        provider,
        modelId,
        latencyMs: Date.now() - startedAt,
      };
    } finally {
      try {
        await unlink(testSessionPath);
      } catch {
        // Scratch file cleanup is best-effort.
      }
      if (previousPath) {
        await this.rpcClient.switchSession(previousPath).catch(() => undefined);
        this.activePath = previousPath;
      }
    }
  }
}

import { randomUUID } from 'node:crypto';

function toLlmRuntimeState(piState: PiState): LlmRuntimeState {
  const model = piState.model;
  const levelMap = model?.thinkingLevelMap;
  const availableThinkingLevels = levelMap && Object.keys(levelMap).length > 0
    ? [
        'off',
        ...Object.entries(levelMap)
          .filter(([, mapping]) => mapping !== null && mapping !== undefined)
          .map(([level]) => level),
      ]
    : DEFAULT_THINKING_LEVELS;
  return {
    runtimeProvider: 'pi-runtime',
    model,
    thinkingLevel: piState.thinkingLevel ?? 'off',
    availableThinkingLevels,
    isStreaming: piState.isStreaming ?? false,
    sessionId: piState.sessionId,
    messageCount: piState.messageCount,
  };
}

function buildPrompt(
  content: string,
  state: RuntimeSessionState,
  workspaceContext?: WorkspaceContext,
  skillHub?: SkillHub,
  readinessProvider?: (skillId: string) => SkillReadiness | undefined,
  locale?: SupportedLocale
): string {
  const recentSymbols = state.recentSymbols.length > 0
    ? `\nRecent symbols: ${state.recentSymbols.join(', ')}`
    : '';

  const workspaceLines: string[] = [];
  if (workspaceContext?.activeSymbol) {
    workspaceLines.push(`- Active symbol: ${workspaceContext.activeSymbol}`);
  }
  if (workspaceContext?.activeView) {
    workspaceLines.push(`- Active workspace view: ${workspaceContext.activeView}`);
  }
  if (workspaceContext?.selectedPosition) {
    workspaceLines.push(`- Selected position: ${workspaceContext.selectedPosition}`);
  }
  const workspaceSection = workspaceLines.length > 0
    ? `\nWorkspace context:\n${workspaceLines.join('\n')}\nWhen the user refers to "this", "the stock", or asks follow-up questions about a symbol without naming it, use the active symbol above.`
    : '';

  const skillSection = buildSkillIndexSection(skillHub, readinessProvider);

  // V8 (spec §41–43): one shared prompt + a stable response-language
  // instruction. Never fork the system prompt per language — only the
  // presentation instruction changes; an explicit user language request in
  // `content` always wins over this default.
  const localeInstruction = locale
    ? `\nPreferred response language: ${RUNTIME_LOCALE_NAMES[locale]} (use this language for your final answer unless the user explicitly asks for another; never translate ticker symbols, tool identifiers, data fields, or citations).`
    : '';

  return [
    'You are Finagent, a finance agent backend.',
    'Use only registered finance tools for market, K-line, intraday, and portfolio data.',
    'Never construct LongBridge CLI commands directly.',
    'Plan, call tools, observe results, then provide the final answer.',
    'Keep the final answer concise and include risk/data-gap notes when relevant.',
    'When the user asks about market data, technicals, fundamentals, news, or portfolio analysis, consult the available skills below, then load the relevant skill file with read_skill_resource before acting on that subtopic.',
    workspaceSection,
    localeInstruction,
    skillSection,
    recentSymbols,
    '',
    `User request: ${content}`,
  ].filter((part) => part.trim().length > 0).join('\n');
}

function buildSkillIndexSection(
  skillHub?: SkillHub,
  readinessProvider?: (skillId: string) => SkillReadiness | undefined
): string {
  if (!skillHub) return '';
  const metadata = skillHub.listSkillMetadata();
  if (metadata.length === 0) return '';
  const lines = metadata.map((entry) => {
    const description = entry.description.length > 160
      ? `${entry.description.slice(0, 160)}…`
      : entry.description;
    const readiness = readinessProvider?.(entry.id);
    const readinessLine = readiness
      ? `  readiness: ${readiness.status} (${readiness.summary}${
          readiness.missing.length > 0 ? `; missing: ${readiness.missing.join(', ')}` : ''
        })`
      : '';
    return `- ${entry.id}: ${description}${readinessLine ? `\n${readinessLine}` : ''}`;
  });
  return `\nAvailable skills (load them with read_skill_resource when relevant):\n${lines.join('\n')}`;
}
