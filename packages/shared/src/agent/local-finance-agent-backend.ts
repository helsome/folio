import type {
  AgentBackend,
  AgentRequest,
  AgentResponse,
  AgentSessionSnapshot,
  ApiError,
  ToolCallRecord,
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

  getTools() {
    return this.registry.getTools();
  }

  async send(request: AgentRequest | string): Promise<AgentResponse> {
    const normalized = normalizeAgentRequest(request);
    const session = this.getSession(normalized.sessionId ?? 'default');
    const routed = routeFinanceIntent(normalized.content, session);

    if (routed.intent === 'unsupported') {
      session.lastIntent = routed.intent;
      return {
        content: unsupportedFinanceMessage(),
        session,
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
      const response = composeToolResponse(toolName, result, toolCall);
      response.session = session;
      return response;
    } catch (error) {
      const apiError = toApiError(error);
      toolCall.status = 'error';
      toolCall.completedAt = this.now();
      toolCall.error = apiError;
      session.lastError = apiError;
      return {
        content: apiError.message,
        tool: toolName,
        toolName,
        toolCalls: [toolCall],
        session,
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

function normalizeAgentRequest(request: AgentRequest | string): AgentRequest {
  if (typeof request === 'string') {
    return { content: request };
  }
  return request;
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
