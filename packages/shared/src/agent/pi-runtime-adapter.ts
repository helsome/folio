import { homedir } from 'node:os';
import { join } from 'node:path';
import { unlink } from 'node:fs/promises';
import type {
  AgentEvent,
  AgentRunInput,
  AgentRuntime,
  ApiResult,
  RuntimeSession,
  ToolCall,
  ToolDefinition,
} from '@finagent/core';
import { FinanceToolRegistry } from './finance-tool-registry.ts';
import { MarketDataService } from './market-data-service.ts';
import { PiRpcClient, type PiRpcClientOptions } from './pi-rpc-client.ts';
import { PiEventAdapter } from './pi-event-adapter.ts';

export interface PiRuntimeAdapterOptions {
  registry?: FinanceToolRegistry;
  marketData?: MarketDataService;
  rpcClient?: PiRpcClient;
  rpc?: PiRpcClientOptions;
  /** Directory holding one JSONL session file per Folio session. */
  sessionDir?: string;
  now?: () => number;
}

interface RuntimeSessionState {
  sessionId: string;
  sessionPath: string;
  runtimeSessionId?: string;
  recentSymbols: string[];
}

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
  private readonly now: () => number;
  private readonly sessions = new Map<string, RuntimeSessionState>();
  /** Session file currently loaded in the Pi runtime. */
  private activePath: string | null = null;

  constructor(options: PiRuntimeAdapterOptions = {}) {
    const marketData = options.marketData ?? new MarketDataService();
    this.registry = options.registry ?? new FinanceToolRegistry(marketData);
    this.rpcClient = options.rpcClient ?? new PiRpcClient(options.rpc);
    this.sessionDir = options.sessionDir ?? join(homedir(), '.finagent', 'pi-sessions');
    this.now = options.now ?? Date.now;
  }

  async getTools(): Promise<ApiResult<ToolDefinition[]>> {
    return { ok: true, data: this.registry.getTools() };
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

  async *run(input: AgentRunInput): AsyncIterable<AgentEvent> {
    const state = this.getOrCreateState(input.sessionId, this.sessionPathFor(input.sessionId));
    try {
      await this.activate(state);
    } catch (error) {
      const adapter = new PiEventAdapter({ sessionId: input.sessionId, runId: input.runId, now: this.now });
      yield* adapter.fail(error);
      return;
    }

    const adapter = new PiEventAdapter({ sessionId: input.sessionId, runId: input.runId, now: this.now });
    const stream = this.rpcClient.promptStreaming(buildPrompt(input.content, state));
    let aborted = false;

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
      yield* adapter.fail(error);
      return;
    }

    if (aborted) {
      yield* adapter.cancelled();
    }
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
  }

  async dispose(): Promise<void> {
    await this.rpcClient.dispose();
  }

  private sessionPathFor(sessionId: string): string {
    return join(this.sessionDir, `${sessionId}.jsonl`);
  }

  private getOrCreateState(sessionId: string, sessionPath: string): RuntimeSessionState {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;
    const state: RuntimeSessionState = {
      sessionId,
      sessionPath,
      recentSymbols: [],
    };
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
}

function buildPrompt(content: string, state: RuntimeSessionState): string {
  const recentSymbols = state.recentSymbols.length > 0
    ? `\nRecent symbols: ${state.recentSymbols.join(', ')}`
    : '';

  return [
    'You are Finagent, a finance agent backend.',
    'Use only registered finance tools for market, K-line, intraday, and portfolio data.',
    'Never construct LongBridge CLI commands directly.',
    'Plan, call tools, observe results, then provide the final answer.',
    'Keep the final answer concise and include risk/data-gap notes when relevant.',
    recentSymbols,
    '',
    `User request: ${content}`,
    ].join('\n');
}
