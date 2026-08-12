import type { Kline, Portfolio, Quote, ToolDefinition, ToolResultProvenance } from '@finagent/core';
import { tools as piTools } from '@finagent/pi-extension';
import type { MarketDataService } from './market-data-service.ts';
import { createCodeError } from './errors.ts';

export type FinanceToolName = 'get_quote' | 'get_portfolio' | 'get_kline' | 'get_intraday';

export interface FinanceToolResult {
  content: Array<{ type: 'text'; text: string }>;
  details: unknown;
  provenance?: ToolResultProvenance;
}

export interface ExecuteToolInput {
  name: FinanceToolName;
  args: Record<string, unknown>;
}

export interface FinanceToolRegistryOptions {
  now?: () => number;
}

const SUPPORTED_TOOL_NAMES: FinanceToolName[] = [
  'get_quote',
  'get_portfolio',
  'get_kline',
  'get_intraday',
];

export class FinanceToolRegistry {
  private readonly marketData: MarketDataService;
  private readonly now: () => number;

  constructor(marketData: MarketDataService, options: FinanceToolRegistryOptions = {}) {
    this.marketData = marketData;
    this.now = options.now ?? Date.now;
  }

  getTools(): ToolDefinition[] {
    return SUPPORTED_TOOL_NAMES.map((name) => piTools.find((tool) => tool.name === name))
      .filter((tool): tool is (typeof piTools)[number] => Boolean(tool))
      .map((tool) => ({
        name: tool.name,
        label: tool.label,
        description: tool.description,
        parameters: tool.parameters as Record<string, unknown>,
      }));
  }

  async execute(input: ExecuteToolInput): Promise<FinanceToolResult> {
    if (input.name === 'get_quote') {
      const symbol = requireSymbol(input.args.symbol);
      const quote = await this.marketData.getQuote(symbol);
      return {
        content: [{ type: 'text', text: formatQuote(quote) }],
        details: quote,
        provenance: {
          provider: 'longbridge',
          fetchedAt: this.now(),
          marketTime: quote.timestamp,
          stale: false,
        },
      };
    }

    if (input.name === 'get_portfolio') {
      const portfolio = await this.marketData.getPortfolio();
      return {
        content: [{ type: 'text', text: formatPortfolio(portfolio) }],
        details: portfolio,
        provenance: {
          provider: 'longbridge',
          fetchedAt: this.now(),
          stale: false,
        },
      };
    }

    if (input.name === 'get_kline') {
      const symbol = requireSymbol(input.args.symbol);
      const period = typeof input.args.period === 'string' ? input.args.period : '1d';
      const limit = typeof input.args.limit === 'number' ? input.args.limit : 100;
      const klines = await this.marketData.getKline({
        symbol,
        period: period as '1m' | '5m' | '15m' | '1h' | '1d' | '1w',
        limit,
      });
      return {
        content: [{ type: 'text', text: formatKline(symbol, period, klines) }],
        details: klines,
        provenance: {
          provider: 'longbridge',
          fetchedAt: this.now(),
          marketTime: klines[klines.length - 1]?.timestamp,
          stale: false,
        },
      };
    }

    if (input.name === 'get_intraday') {
      const symbol = requireSymbol(input.args.symbol);
      const intraday = await this.marketData.getIntraday(symbol);
      return {
        content: [{ type: 'text', text: formatIntraday(symbol, intraday) }],
        details: intraday,
        provenance: {
          provider: 'longbridge',
          fetchedAt: this.now(),
          marketTime: intraday[intraday.length - 1]?.timestamp,
          stale: false,
        },
      };
    }

    throw createCodeError('TOOL_NOT_FOUND', `Tool is not registered: ${input.name}`);
  }
}

function requireSymbol(value: unknown) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw createCodeError('INVALID_ARGUMENT', 'symbol is required.');
  }
  return value.trim().toUpperCase();
}

function formatQuote(quote: Quote) {
  const changeIcon = quote.change >= 0 ? '[up]' : '[down]';
  const changeStr = quote.change >= 0
    ? `+${quote.change.toFixed(2)} (+${quote.changePercent.toFixed(2)}%)`
    : `${quote.change.toFixed(2)} (${quote.changePercent.toFixed(2)}%)`;
  const asOf = new Date(quote.timestamp * 1000).toLocaleString();

  return [
    `${changeIcon} ${quote.symbol}: $${quote.lastPrice.toFixed(2)}`,
    `Change: ${changeStr}`,
    `Volume: ${quote.volume.toLocaleString()}`,
    `High: $${quote.high.toFixed(2)} | Low: $${quote.low.toFixed(2)}`,
    `Open: $${quote.open.toFixed(2)} | Prev Close: $${quote.prevClose.toFixed(2)}`,
    `As of: ${asOf}`,
  ].join('\n');
}

function formatPortfolio(portfolio: Portfolio) {
  const positionsText = portfolio.positions.length > 0
    ? portfolio.positions.map((position) => {
        const pnlStr = position.unrealizedPnL >= 0
          ? `+$${position.unrealizedPnL.toFixed(2)} (+${position.unrealizedPnLPercent.toFixed(2)}%)`
          : `$${position.unrealizedPnL.toFixed(2)} (${position.unrealizedPnLPercent.toFixed(2)}%)`;
        return [
          `  ${position.symbol}: ${position.quantity} shares @ $${position.avgCost.toFixed(2)}`,
          `     Current: $${position.lastPrice.toFixed(2)} | Value: $${position.marketValue.toFixed(2)}`,
          `     P&L: ${pnlStr}`,
        ].join('\n');
      }).join('\n')
    : '  No positions';

  return [
    'Portfolio Summary',
    '-----------------',
    `Total Value: $${portfolio.totalValue.toFixed(2)}`,
    `Cash: $${portfolio.cash.toFixed(2)}`,
    '',
    `Positions (${portfolio.positions.length})`,
    positionsText,
  ].join('\n');
}

function formatKline(symbol: string, period: string, klines: Kline[]) {
  const recent = klines.slice(-5);
  return [
    `${symbol} K-Line (${period})`,
    '-----------------',
    ...recent.map((kline) => {
      const date = new Date(kline.timestamp * 1000).toLocaleDateString();
      return `${date}: O$${kline.open.toFixed(2)} H$${kline.high.toFixed(2)} L$${kline.low.toFixed(2)} C$${kline.close.toFixed(2)} V${kline.volume}`;
    }),
  ].join('\n');
}

function formatIntraday(symbol: string, data: Array<{ timestamp: number; price: number; volume: number }>) {
  const recent = data.slice(-10);
  return [
    `${symbol} Intraday`,
    '-----------------',
    ...recent.map((item) => {
      const time = new Date(item.timestamp * 1000).toLocaleTimeString();
      return `${time}: $${item.price.toFixed(2)} (V: ${item.volume})`;
    }),
  ].join('\n');
}
