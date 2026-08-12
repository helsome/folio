import type {
  AgentBackend,
  AgentRequest,
  AgentResponse,
  AgentSessionSnapshot,
  ApiResult,
  Kline,
  Portfolio,
  Quote,
  ToolCallRecord,
  ToolDefinition,
} from '@finagent/core';
import { FinanceToolRegistry, type FinanceToolName } from './finance-tool-registry.ts';
import { routeFinanceIntent, unsupportedFinanceMessage } from './intent-router.ts';
import { MarketDataService } from './market-data-service.ts';
import { composeToolResponse } from './response-composer.ts';
import { toApiError } from './errors.ts';

export interface LocalFinanceAgentBackendOptions {
  registry?: FinanceToolRegistry;
  marketData?: MarketDataService;
  now?: () => number;
}

export class LocalFinanceAgentBackend implements AgentBackend {
  private readonly registry: FinanceToolRegistry;
  private readonly now: () => number;
  private readonly sessions = new Map<string, AgentSessionSnapshot>();

  constructor(options: LocalFinanceAgentBackendOptions = {}) {
    this.now = options.now ?? Date.now;
    const marketData = options.marketData ?? new MarketDataService();
    this.registry = options.registry ?? new FinanceToolRegistry(marketData, { now: this.now });
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

    if (routed.intent === 'portfolio_risk') {
      return { ok: true, data: await this.answerPortfolioRisk(session) };
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
      toolCall.result = structuredResult(result.details, result.provenance);
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

  /** Restore persisted session context (e.g. recent symbols) after a restart. */
  restoreSession(sessionId: string, recentSymbols: string[]): void {
    const session = this.getSession(sessionId);
    if (recentSymbols.length > 0) {
      session.recentSymbols = recentSymbols.slice(0, 5);
    }
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

  private async answerPortfolioRisk(session: AgentSessionSnapshot): Promise<AgentResponse> {
    const toolCalls: ToolCallRecord[] = [];
    session.lastIntent = 'portfolio_risk';

    const executeStep = async (toolName: FinanceToolName, args: Record<string, unknown>) => {
      const toolCall = this.createToolCall(toolName, args);
      toolCalls.push(toolCall);
      session.toolCalls.unshift(toolCall);
      try {
        const result = await this.registry.execute({ name: toolName, args });
        toolCall.status = 'success';
        toolCall.completedAt = this.now();
        toolCall.result = structuredResult(result.details, result.provenance);
        return result.details;
      } catch (error) {
        const apiError = toApiError(error);
        toolCall.status = 'error';
        toolCall.completedAt = this.now();
        toolCall.error = apiError;
        session.lastError = apiError;
        return undefined;
      }
    };

    const portfolio = await executeStep('get_portfolio', {}) as Portfolio | undefined;
    const positions = portfolio?.positions ?? [];
    const symbols = positions.map((position) => position.symbol).slice(0, 5);
    const quotes = new Map<string, Quote>();
    const klines = new Map<string, Kline[]>();

    for (const symbol of symbols) {
      const quote = await executeStep('get_quote', { symbol }) as Quote | undefined;
      if (quote) {
        quotes.set(symbol, quote);
        rememberSymbol(session, symbol);
      }
      const kline = await executeStep('get_kline', { symbol, period: '1d', limit: 30 }) as Kline[] | undefined;
      if (kline) klines.set(symbol, kline);
    }

    const content = composePortfolioRiskAnswer(portfolio, quotes, klines, toolCalls);
    return {
      answer: content,
      content,
      toolName: 'get_portfolio',
      tool: 'portfolio_risk',
      toolCalls,
      session,
      sessionSnapshot: session,
      trace: toolCalls.map((toolCall) => ({
        id: `${toolCall.id}:trace`,
        type: 'tool_call',
        timestamp: toolCall.completedAt ?? toolCall.startedAt,
        message: `${toolCall.toolName} ${toolCall.status}`,
        data: {
          args: toolCall.args,
          error: toolCall.error,
        },
      })),
    };
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

function composePortfolioRiskAnswer(
  portfolio: Portfolio | undefined,
  quotes: Map<string, Quote>,
  klines: Map<string, Kline[]>,
  toolCalls: ToolCallRecord[]
) {
  if (!portfolio) {
    return '无法完成组合风险分析：持仓数据不可用。请检查 LongBridge 连接后重试。';
  }

  const investedValue = Math.max(portfolio.totalValue - portfolio.cash, 0);
  const cashRatio = portfolio.totalValue > 0 ? portfolio.cash / portfolio.totalValue : 0;
  const sortedPositions = [...portfolio.positions].sort((a, b) => b.marketValue - a.marketValue);
  const topPosition = sortedPositions[0];
  const topWeight = topPosition && portfolio.totalValue > 0 ? topPosition.marketValue / portfolio.totalValue : 0;
  const failedCalls = toolCalls.filter((toolCall) => toolCall.status === 'error');
  const volatilityLines = sortedPositions.slice(0, 5).map((position) => {
    const series = klines.get(position.symbol) ?? [];
    const volatility = estimateVolatility(series);
    const quote = quotes.get(position.symbol);
    const dayMove = quote ? `${quote.changePercent.toFixed(2)}%` : 'n/a';
    const weight = portfolio.totalValue > 0 ? position.marketValue / portfolio.totalValue : 0;
    return `- ${position.symbol}: weight ${formatPercent(weight)}, 30d vol ${volatility}, day ${dayMove}`;
  });

  const concentrationRisk = topWeight >= 0.35 ? '高' : topWeight >= 0.2 ? '中' : '低';
  const marketRisk = averageVolatility(klines) >= 0.03 ? '高' : averageVolatility(klines) >= 0.018 ? '中' : '低';

  return [
    'Portfolio Risk Summary',
    '----------------------',
    `Total value: $${portfolio.totalValue.toFixed(2)} | Invested: $${investedValue.toFixed(2)} | Cash: ${formatPercent(cashRatio)}`,
    `Concentration risk: ${concentrationRisk}${topPosition ? ` (${topPosition.symbol} ${formatPercent(topWeight)})` : ''}`,
    `Market volatility risk: ${marketRisk}`,
    '',
    'Position signals',
    ...(volatilityLines.length > 0 ? volatilityLines : ['- No positions to analyze.']),
    '',
    'Notes',
    '- This is a deterministic risk screen based on holdings, quotes, and recent K-line volatility.',
    failedCalls.length > 0
      ? `- Data gaps: ${failedCalls.map((toolCall) => `${toolCall.toolName} failed`).join(', ')}.`
      : '- Data gaps: none from executed tools.',
  ].join('\n');
}

function estimateVolatility(klines: Kline[]) {
  const value = calculateVolatility(klines);
  return value === 0 ? 'n/a' : formatPercent(value);
}

function averageVolatility(klines: Map<string, Kline[]>) {
  const values = [...klines.values()].map(calculateVolatility).filter((value) => value > 0);
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function calculateVolatility(klines: Kline[]) {
  const closes = klines.map((kline) => kline.close).filter((value) => Number.isFinite(value) && value > 0);
  if (closes.length < 3) return 0;
  const returns = closes.slice(1).map((close, index) => close / closes[index] - 1);
  const average = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - average) ** 2, 0) / returns.length;
  return Math.sqrt(variance);
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function rememberSymbol(session: AgentSessionSnapshot, symbol: string) {
  session.recentSymbols = [
    symbol,
    ...session.recentSymbols.filter((existing) => existing !== symbol),
  ].slice(0, 5);
}

function structuredResult(details: unknown, provenance?: { provider: string; fetchedAt: number }) {
  if (!provenance) return details;
  return { data: details, provenance };
}
