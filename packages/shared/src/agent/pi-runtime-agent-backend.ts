import type {
  AgentBackend,
  AgentRequest,
  AgentResponse,
  AgentSessionSnapshot,
  ApiResult,
  ToolDefinition,
} from '@finagent/core';
import { FinanceToolRegistry } from './finance-tool-registry.ts';
import { MarketDataService } from './market-data-service.ts';
import { PiRpcClient, type PiRpcClientOptions } from './pi-rpc-client.ts';
import { toApiError } from './errors.ts';

export interface PiRuntimeAgentBackendOptions {
  registry?: FinanceToolRegistry;
  marketData?: MarketDataService;
  rpcClient?: PiRpcClient;
  rpc?: PiRpcClientOptions;
}

export class PiRuntimeAgentBackend implements AgentBackend {
  private readonly registry: FinanceToolRegistry;
  private readonly rpcClient: PiRpcClient;
  private readonly sessions = new Map<string, AgentSessionSnapshot>();

  constructor(options: PiRuntimeAgentBackendOptions = {}) {
    const marketData = options.marketData ?? new MarketDataService();
    this.registry = options.registry ?? new FinanceToolRegistry(marketData);
    this.rpcClient = options.rpcClient ?? new PiRpcClient(options.rpc);
  }

  async getTools(): Promise<ApiResult<ToolDefinition[]>> {
    return { ok: true, data: this.registry.getTools() };
  }

  async send(request: AgentRequest): Promise<ApiResult<AgentResponse>> {
    const session = this.getSession(request.sessionId);

    try {
      await this.rpcClient.healthCheck();
      const result = await this.rpcClient.prompt(buildPrompt(request, session));
      session.toolCalls = [...result.toolCalls, ...session.toolCalls].slice(0, 50);
      for (const toolCall of result.toolCalls) {
        const symbol = typeof toolCall.args.symbol === 'string' ? toolCall.args.symbol.toUpperCase() : undefined;
        if (symbol) rememberSymbol(session, symbol);
      }

      const answer = result.answer || 'Pi runtime completed without a text answer.';
      return {
        ok: true,
        data: {
          answer,
          content: answer,
          toolCalls: result.toolCalls,
          session,
          sessionSnapshot: session,
          trace: result.trace,
        },
      };
    } catch (error) {
      const apiError = toApiError(error);
      session.lastError = apiError;
      return {
        ok: false,
        error: apiError,
      };
    }
  }

  async dispose(): Promise<void> {
    await this.rpcClient.dispose();
  }

  private getSession(sessionId: string): AgentSessionSnapshot {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;

    const session: AgentSessionSnapshot = {
      id: sessionId,
      recentSymbols: [],
      toolCalls: [],
    };
    this.sessions.set(sessionId, session);
    return session;
  }
}

function buildPrompt(request: AgentRequest, session: AgentSessionSnapshot) {
  const context = request.context ? `\nOptional context: ${JSON.stringify(request.context)}` : '';
  const recentSymbols = session.recentSymbols.length > 0
    ? `\nRecent symbols: ${session.recentSymbols.join(', ')}`
    : '';

  return [
    'You are Finagent, a finance agent backend.',
    'Use only registered finance tools for market, K-line, intraday, and portfolio data.',
    'Never construct LongBridge CLI commands directly.',
    'Plan, call tools, observe results, then provide the final answer.',
    'Keep the final answer concise and include risk/data-gap notes when relevant.',
    recentSymbols,
    context,
    '',
    `User request: ${request.content}`,
  ].join('\n');
}

function rememberSymbol(session: AgentSessionSnapshot, symbol: string) {
  session.recentSymbols = [
    symbol,
    ...session.recentSymbols.filter((existing) => existing !== symbol),
  ].slice(0, 5);
}
