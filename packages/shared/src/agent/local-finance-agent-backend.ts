import type {
  AgentBackend,
  AgentRequest,
  AgentResponse,
  AgentSessionSnapshot,
  ApiResult,
  ToolCallRecord,
  ToolDefinition,
} from '@finagent/core';
import { FinanceToolRegistry, type FinanceToolName } from './finance-tool-registry.ts';
import { routeFinanceIntent, unsupportedFinanceMessage } from './intent-router.ts';
import { MarketDataService } from './market-data-service.ts';
import { composeToolResponse } from './response-composer.ts';
import { toApiError } from './errors.ts';

interface LocalFinanceAgentBackendOptions {
  registry?: FinanceToolRegistry;
  marketData?: MarketDataService;
  now?: () => number;
}

export class LocalFinanceAgentBackend implements AgentBackend {
  private readonly registry: FinanceToolRegistry;
  private readonly now: () => number;
  private readonly sessions = new Map<string, AgentSessionSnapshot>();

  constructor(options: LocalFinanceAgentBackendOptions = {}) {
    const marketData = options.marketData ?? new MarketDataService();
    this.registry = options.registry ?? new FinanceToolRegistry(marketData);
    this.now = options.now ?? Date.now;
  }

  async getTools(): Promise<ApiResult<ToolDefinition[]>> {
    return { ok: true, data: this.registry.getTools() };
  }

  async send(request: AgentRequest): Promise<ApiResult<AgentResponse>> {
    const session = this.getSession(request.sessionId);
    const routed = routeFinanceIntent(request.content, session);

    if (routed.intent === 'unsupported') {
      session.lastIntent = routed.intent;
      const content = unsupportedFinanceMessage();
      return {
        ok: true,
        data: {
          answer: content,
          content,
          session,
          sessionSnapshot: session,
          toolCalls: [],
        },
      };
    }

    const toolName = intentToToolName(routed.intent);
    const args = routed.symbol ? { symbol: routed.symbol } : {};
    const toolCall = this.createToolCall(toolName, args);
    session.toolCalls.unshift(toolCall);
    session.lastIntent = routed.intent;

    try {
      const result = await this.registry.execute({ name: toolName, args });
      toolCall.status = 'success';
      toolCall.completedAt = this.now();
      if (routed.symbol) {
        rememberSymbol(session, routed.symbol);
      }
      toolCall.result = result.details;
      const response = composeToolResponse(toolName, result, toolCall, session);
      response.session = session;
      return { ok: true, data: response };
    } catch (error) {
      const apiError = toApiError(error);
      toolCall.status = 'error';
      toolCall.completedAt = this.now();
      toolCall.error = apiError;
      session.lastError = apiError;
      return {
        ok: true,
        data: {
          answer: apiError.message,
          content: apiError.message,
          tool: toolName,
          toolName,
          toolCalls: [toolCall],
          session,
          sessionSnapshot: session,
        },
      };
    }
  }

  getSessionSnapshot(sessionId = 'default') {
    return this.getSession(sessionId);
  }

  private getSession(sessionId: string): AgentSessionSnapshot {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      return existing;
    }

    const session: AgentSessionSnapshot = {
      id: sessionId,
      recentSymbols: [],
      toolCalls: [],
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  private createToolCall(toolName: FinanceToolName, args: Record<string, unknown>): ToolCallRecord {
    return {
      id: `${toolName}-${this.now()}`,
      toolName,
      args,
      startedAt: this.now(),
      status: 'success',
    };
  }
}

function intentToToolName(intent: 'quote' | 'kline' | 'portfolio' | 'intraday'): FinanceToolName {
  if (intent === 'portfolio') return 'get_portfolio';
  if (intent === 'kline') return 'get_kline';
  if (intent === 'intraday') return 'get_intraday';
  return 'get_quote';
}

function rememberSymbol(session: AgentSessionSnapshot, symbol: string) {
  session.recentSymbols = [
    symbol,
    ...session.recentSymbols.filter((existing) => existing !== symbol),
  ].slice(0, 5);
}
