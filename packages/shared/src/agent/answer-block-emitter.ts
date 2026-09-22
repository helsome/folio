import type {
  AnswerBlock,
  ComparisonTableBlock,
  DataTableBlock,
  Kline,
  MetricGridBlock,
  PortfolioSnapshot,
  Quote,
  TimeSeriesChartBlock,
} from '@finagent/core';
import { ANSWER_BLOCK_FENCE_LANG } from '@finagent/core';

/**
 * Deterministic builders that turn local-provider tool results into typed
 * answer blocks (#31). The Copilot UI renders these as KPI cards, tables, and
 * charts; the Pi runtime path receives the same fence format through its
 * system prompt so both backends share one presentation contract.
 */

/** Best-effort display currency for a routed symbol suffix (AAPL.US → USD). */
export function currencyForSymbol(symbol: string): string {
  if (/\.HK$/i.test(symbol)) return 'HKD';
  if (/\.SH$|\.SZ$/i.test(symbol)) return 'CNY';
  if (/\.SG$/i.test(symbol)) return 'SGD';
  return 'USD';
}

/** Serialize one block into the fenced payload embedded in an answer string. */
export function renderBlockFence(block: AnswerBlock): string {
  return `\`\`\`${ANSWER_BLOCK_FENCE_LANG}\n${JSON.stringify(block)}\n\`\`\``;
}

/** Append rendered blocks after the Markdown answer, keeping text order stable. */
export function appendBlocksToAnswer(answer: string, blocks: AnswerBlock[]): string {
  if (blocks.length === 0) return answer;
  return `${answer}\n\n${blocks.map(renderBlockFence).join('\n\n')}`;
}

function toIso(epoch: number | undefined): string | undefined {
  if (epoch === undefined || !Number.isFinite(epoch)) return undefined;
  // Repo convention: Quote/Kline timestamps are epoch SECONDS (see
  // longbridge-tools normalizer). Accept ms too, defensively.
  const ms = Math.abs(epoch) < 1e12 ? epoch * 1000 : epoch;
  return new Date(ms).toISOString();
}

/** KPI grid + 30-day close series for a quote answer. */
export function buildQuoteAnswerBlocks(
  quote: Quote,
  klines: Kline[] | undefined,
  evidenceIds: string[],
  source?: string
): AnswerBlock[] {
  const currency = currencyForSymbol(quote.symbol);
  const asOf = toIso(quote.timestamp);

  const metricGrid: MetricGridBlock = {
    version: 1,
    type: 'metric_grid',
    title: `${quote.symbol} key metrics`,
    source,
    evidenceIds,
    metrics: [
      {
        label: 'Last',
        value: quote.lastPrice,
        unit: 'price',
        currency,
        asOf,
        change: quote.change,
        changePercent: quote.changePercent,
        evidenceIds: evidenceIds.slice(0, 1),
      },
      { label: 'Change %', value: quote.changePercent, unit: 'percent' },
      { label: 'Open', value: quote.open, unit: 'price', currency },
      { label: 'High', value: quote.high, unit: 'price', currency },
      { label: 'Low', value: quote.low, unit: 'price', currency },
      { label: 'Prev close', value: quote.prevClose, unit: 'price', currency },
      { label: 'Volume', value: quote.volume, unit: 'count' },
    ],
  };

  const blocks: AnswerBlock[] = [metricGrid];

  const series = [...(klines ?? [])]
    .filter((kline) => Number.isFinite(kline.close) && Number.isFinite(kline.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-30)
    // Repo convention: Kline.timestamp is epoch SECONDS (see toIso) — passing
    // it to `new Date()` directly rendered every chart point in Jan 1970.
    .map((kline) => {
      const t = toIso(kline.timestamp);
      return t === undefined ? undefined : { t, v: kline.close };
    })
    .filter((point): point is { t: string; v: number } => point !== undefined);
  if (series.length >= 2) {
    const chart: TimeSeriesChartBlock = {
      version: 1,
      type: 'time_series_chart',
      title: `${quote.symbol} daily close (30d)`,
      unit: 'price',
      currency,
      asOf: series[series.length - 1].t,
      source,
      evidenceIds,
      points: series,
    };
    blocks.push(chart);
  }
  return blocks;
}

/** Holdings table for a portfolio answer (values in the portfolio base currency). */
export function buildPortfolioTableBlock(
  snapshot: PortfolioSnapshot,
  evidenceIds: string[],
  source?: string
): AnswerBlock | null {
  const holdings = snapshot.holdings ?? [];
  if (holdings.length === 0) return null;
  const currency = (snapshot.baseCurrency ?? 'USD').toUpperCase();
  const totalAssets = snapshot.totalAssets;

  const rows = holdings.map((holding) => {
    const value = holding.marketValueBase ?? holding.marketValue;
    const weight = value !== undefined && totalAssets !== undefined && totalAssets > 0
      ? value / totalAssets
      : null;
    return {
      symbol: holding.symbol,
      qty: holding.quantity ?? null,
      value: value ?? null,
      weight,
      pnlPct: holding.unrealizedPnLPercent ?? null,
    };
  });

  const block: DataTableBlock = {
    version: 1,
    type: 'data_table',
    title: 'Portfolio holdings',
    source,
    evidenceIds,
    columns: [
      { key: 'symbol', label: 'Symbol' },
      { key: 'qty', label: 'Qty', unit: 'count' },
      { key: 'value', label: 'Value', unit: 'price', currency },
      { key: 'weight', label: 'Weight', unit: 'ratio' },
      { key: 'pnlPct', label: 'P&L %', unit: 'percent' },
    ],
    rows,
  };
  return block;
}

export interface RiskComparisonInput {
  symbol: string;
  weight: number | null;
  volatility: number | null;
  dayChangePercent: number | null;
}

/** Position-by-position risk comparison for the portfolio_risk answer. */
export function buildRiskComparisonBlock(
  inputs: RiskComparisonInput[],
  evidenceIds: string[],
  source?: string
): AnswerBlock | null {
  if (inputs.length < 2) return null;
  const block: ComparisonTableBlock = {
    version: 1,
    type: 'comparison_table',
    title: 'Position comparison',
    source,
    evidenceIds,
    columns: inputs.map((input) => ({ id: input.symbol, label: input.symbol })),
    rows: [
      {
        label: 'Weight',
        unit: 'ratio',
        values: inputs.map((input) => input.weight),
      },
      {
        label: '30d volatility',
        unit: 'ratio',
        values: inputs.map((input) => input.volatility),
      },
      {
        label: 'Day change',
        unit: 'percent',
        values: inputs.map((input) => input.dayChangePercent),
      },
    ],
  };
  return block;
}

/** Annualized-agnostic daily-return standard deviation over closes. */
export function dailyVolatility(klines: Kline[] | undefined): number | null {
  const closes = (klines ?? [])
    .map((kline) => kline.close)
    .filter((value) => Number.isFinite(value) && value > 0);
  if (closes.length < 3) return null;
  const returns = closes.slice(1).map((close, index) => close / closes[index] - 1);
  const average = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - average) ** 2, 0) / returns.length;
  return Math.sqrt(variance);
}
