import type {
  AllocationItem,
  CapabilityRegistry,
  CapabilityRunRecord,
  Holding,
  Kline,
  NewsItem,
  PortfolioRiskReport,
  PortfolioSnapshot,
  Quote,
  RiskSeverity,
  RiskSignal,
} from '@finagent/core';
import type { CapabilityExecutor, RunOutcome } from '../capabilities/executor.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const EARNINGS_HORIZON_MS = 7 * DAY_MS;
const NEWS_RECENT_MS = 7 * DAY_MS;
const DRAWDOWN_WINDOW_BARS = 20;
const KLINE_LIMIT = 30;
const NEWS_TOP_POSITIONS = 3;
const QUOTE_CONCURRENCY = 4;
const SIDE_CONCURRENCY = 4;

/** One condensed run entry, as embedded in the report's `capabilityRuns`. */
type CapabilityRunEntry = PortfolioRiskReport['capabilityRuns'][number];

/** Facts handed to the synthesizer (same shape the Lead's agent sees). */
export interface PortfolioRiskSynthesisInput {
  allocation: AllocationItem[];
  concentration: PortfolioRiskReport['concentration'];
  signals: RiskSignal[];
  capabilityRuns: PortfolioRiskReport['capabilityRuns'];
}

/**
 * Turns the computed risk facts into the report's prose summary. The default
 * is a deterministic local writer; the Lead injects an agent-backed
 * implementation at integration.
 */
export type PortfolioRiskSynthesizer = (
  input: PortfolioRiskSynthesisInput,
  signal?: AbortSignal
) => Promise<string>;

export interface PortfolioRiskServiceOptions {
  registry: CapabilityRegistry;
  executor: CapabilityExecutor;
  synthesizer?: PortfolioRiskSynthesizer;
  now?: () => number;
}

/**
 * Portfolio risk analysis: allocation + concentration derived from portfolio
 * data, and risk signals derived from market/research/company capabilities.
 * Every threshold is honest and computed only from real (registered) data —
 * missing capabilities are skipped and recorded, never guessed.
 */
export class PortfolioRiskService {
  private readonly registry: CapabilityRegistry;
  private readonly executor: CapabilityExecutor;
  private readonly synthesizer: PortfolioRiskSynthesizer;
  private readonly now: () => number;

  constructor(options: PortfolioRiskServiceOptions) {
    this.registry = options.registry;
    this.executor = options.executor;
    this.synthesizer = options.synthesizer ?? defaultPortfolioRiskSynthesizer;
    this.now = options.now ?? Date.now;
  }

  async analyze(signal?: AbortSignal): Promise<PortfolioRiskReport> {
    const runs: CapabilityRunEntry[] = [];
    const nowMs = this.now();

    // ── 1. Core portfolio data ────────────────────────────────────────────
    const summaryCap = this.registry.get('portfolio.summary');
    const positionsCap = this.registry.get('portfolio.positions');

    const summaryOutcome = summaryCap
      ? await this.executor.run(summaryCap, {}, { signal })
      : undefined;
    const positionsOutcome = positionsCap
      ? await this.executor.run(positionsCap, {}, { signal })
      : undefined;

    if (summaryOutcome) runs.push(toRunEntry(summaryOutcome.record));
    else runs.push(missingRun('portfolio.summary'));
    if (positionsOutcome) runs.push(toRunEntry(positionsOutcome.record));
    else runs.push(missingRun('portfolio.positions'));

    const summaryData = summaryOutcome?.result?.data;
    const summaryPortfolio = isPortfolioSnapshot(summaryData) ? summaryData : undefined;
    const rawPositions = resolvePositions(summaryPortfolio, positionsOutcome);
    const hasPositions = rawPositions.length > 0;

    // ── 2. Quotes per position (market-value fallback + evidence) ─────────
    const quoteCap = this.registry.get('market.quote');
    const quoteOutcomes =
      quoteCap && hasPositions
        ? await this.executor.runAll(
            rawPositions.map((p) => ({ cap: quoteCap, input: { symbol: p.symbol } })),
            { concurrency: QUOTE_CONCURRENCY, signal }
          )
        : [];
    if (!quoteCap && hasPositions) runs.push(missingRun('market.quote'));
    for (const outcome of quoteOutcomes) runs.push(toRunEntry(outcome.record));

    const allocation = buildAllocation(rawPositions, quoteOutcomes, summaryPortfolio);
    const concentration = computeConcentration(allocation);

    // ── 3. Market + research + company fetches (evidence + signals) ───────
    const klineCap = this.registry.get('market.kline');
    const klineOutcomes =
      klineCap && allocation.length > 0
        ? await this.executor.runAll(
            allocation.map((item) => ({
              cap: klineCap,
              input: { symbol: item.symbol, period: '1d', limit: KLINE_LIMIT },
            })),
            { concurrency: SIDE_CONCURRENCY, signal }
          )
        : [];
    if (!klineCap && hasPositions) runs.push(missingRun('market.kline'));
    for (const outcome of klineOutcomes) runs.push(toRunEntry(outcome.record));

    const profileCap = this.registry.get('company.profile');
    const profileOutcomes =
      profileCap && allocation.length > 0
        ? await this.executor.runAll(
            allocation.map((item) => ({ cap: profileCap, input: { symbol: item.symbol } })),
            { concurrency: SIDE_CONCURRENCY, signal }
          )
        : [];
    if (!profileCap && hasPositions) runs.push(missingRun('company.profile'));
    for (const outcome of profileOutcomes) runs.push(toRunEntry(outcome.record));

    const eventsCap = this.registry.get('research.events');
    let eventsData: unknown;
    if (eventsCap && hasPositions) {
      const eventsOutcome = await this.executor.run(eventsCap, {}, { signal });
      runs.push(toRunEntry(eventsOutcome.record));
      eventsData = eventsOutcome.result?.data;
    } else if (!eventsCap && hasPositions) {
      runs.push(missingRun('research.events'));
    }

    const newsCap = this.registry.get('research.news');
    const top3 = allocation.slice(0, NEWS_TOP_POSITIONS);
    const newsOutcomes =
      newsCap && top3.length > 0
        ? await this.executor.runAll(
            top3.map((item) => ({ cap: newsCap, input: { symbol: item.symbol } })),
            { concurrency: SIDE_CONCURRENCY, signal }
          )
        : [];
    if (!newsCap && hasPositions) runs.push(missingRun('research.news'));
    for (const outcome of newsOutcomes) runs.push(toRunEntry(outcome.record));

    // ── 4. Signals (spec order) ───────────────────────────────────────────
    const signals: RiskSignal[] = [];
    const concentrationSignal = buildConcentrationSignal(concentration.top1Weight);
    if (concentrationSignal) signals.push(concentrationSignal);
    signals.push(...buildLargePositionSignals(allocation));

    const earningsSignal = buildUpcomingEarningsSignal(allocation, eventsData, nowMs);
    if (earningsSignal) signals.push(earningsSignal);

    const newsSignal = buildNewsExposureSignal(newsOutcomes, nowMs);
    if (newsSignal) signals.push(newsSignal);

    signals.push(...buildDrawdownSignals(allocation, klineOutcomes));

    const sectorSignal = buildSectorExposureSignal(allocation, profileOutcomes);
    if (sectorSignal) signals.push(sectorSignal);

    // ── 5. Summary + report ───────────────────────────────────────────────
    const summary = await this.synthesizer(
      { allocation, concentration, signals, capabilityRuns: runs },
      signal
    );

    return {
      id: `risk-${nowMs}`,
      generatedAt: nowMs,
      summary,
      allocation,
      concentration,
      signals,
      capabilityRuns: runs,
    };
  }
}

// ── Allocation + concentration (pure) ──────────────────────────────────────

function resolvePositions(
  summary: PortfolioSnapshot | undefined,
  positionsOutcome: RunOutcome | undefined
): Holding[] {
  if (summary && summary.holdings.length > 0) {
    return summary.holdings.filter(isHolding);
  }
  const positionsData = positionsOutcome?.result?.data;
  return isHoldingArray(positionsData) ? positionsData : [];
}

function buildAllocation(
  rawPositions: Holding[],
  quoteOutcomes: RunOutcome[],
  summary: PortfolioSnapshot | undefined
): AllocationItem[] {
  const resolved: Array<{ symbol: string; marketValue: number }> = [];
  rawPositions.forEach((position, index) => {
    const marketValue = resolveMarketValue(position, quoteOutcomes[index]);
    if (marketValue > 0) resolved.push({ symbol: position.symbol, marketValue });
  });

  const total =
    summary && typeof summary.marketValue === 'number' && summary.marketValue > 0
      ? summary.marketValue
      : resolved.reduce((sum, item) => sum + item.marketValue, 0);

  return resolved
    .map((item) => ({ ...item, weight: total > 0 ? item.marketValue / total : 0 }))
    .sort(byWeightDesc);
}

/**
 * Prefer the position's own market value (base-currency `marketValueBase` first,
 * then `marketValue`); when both are absent, derive it from the quote
 * (quantity × last price). Returns 0 when nothing is available so the caller
 * excludes the position.
 */
function resolveMarketValue(position: Holding, quoteOutcome: RunOutcome | undefined): number {
  if (typeof position.marketValueBase === 'number' && position.marketValueBase > 0) {
    return position.marketValueBase;
  }
  if (typeof position.marketValue === 'number' && position.marketValue > 0) {
    return position.marketValue;
  }
  const quote = quoteOutcome?.result?.data;
  const lastPrice = isQuote(quote) ? quote.lastPrice : undefined;
  if (typeof lastPrice === 'number' && typeof position.quantity === 'number') {
    return position.quantity * lastPrice;
  }
  return 0;
}

function computeConcentration(allocation: AllocationItem[]): PortfolioRiskReport['concentration'] {
  const weights = allocation.map((a) => a.weight).sort((a, b) => b - a);
  const top1Weight = weights[0] ?? 0;
  const top5Weight = weights.slice(0, 5).reduce((sum, w) => sum + w, 0);
  const herfindahl = allocation.reduce((sum, a) => sum + a.weight * a.weight, 0);
  return { top1Weight, top5Weight, herfindahl };
}

// ── Signal builders (pure, honest thresholds) ──────────────────────────────

function buildConcentrationSignal(top1Weight: number): RiskSignal | null {
  if (top1Weight > 0.3) {
    return {
      kind: 'concentration',
      severity: 'high',
      title: 'High concentration',
      detail: `The top position is ${pct(top1Weight)} of the portfolio.`,
    };
  }
  if (top1Weight > 0.2) {
    return {
      kind: 'concentration',
      severity: 'medium',
      title: 'Concentration risk',
      detail: `The top position is ${pct(top1Weight)} of the portfolio.`,
    };
  }
  return null;
}

function buildLargePositionSignals(allocation: AllocationItem[]): RiskSignal[] {
  const signals: RiskSignal[] = [];
  for (const item of allocation) {
    if (item.weight > 0.25) {
      signals.push({
        kind: 'large_position',
        severity: 'high',
        symbol: item.symbol,
        title: `Large position: ${item.symbol}`,
        detail: `${item.symbol} is ${pct(item.weight)} of the portfolio.`,
      });
    } else if (item.weight > 0.15) {
      signals.push({
        kind: 'large_position',
        severity: 'medium',
        symbol: item.symbol,
        title: `Large position: ${item.symbol}`,
        detail: `${item.symbol} is ${pct(item.weight)} of the portfolio.`,
      });
    }
  }
  return signals;
}

function buildUpcomingEarningsSignal(
  allocation: AllocationItem[],
  eventsData: unknown,
  nowMs: number
): RiskSignal | null {
  const events = extractEvents(eventsData);
  if (events.length === 0) return null;

  const symbols = new Set(allocation.map((a) => a.symbol.toUpperCase()));
  const horizonEnd = nowMs + EARNINGS_HORIZON_MS;
  const matched = new Set<string>();

  for (const event of events) {
    if (typeof event.type !== 'string' || !/earn/i.test(event.type)) continue;
    const at = toEpochMs(event.date);
    if (at === undefined || at < nowMs || at > horizonEnd) continue;
    if (!event.symbol) continue;
    const symbol = event.symbol.trim().toUpperCase();
    if (symbols.has(symbol)) matched.add(symbol);
  }

  if (matched.size === 0) return null;
  const list = [...matched].sort().join(', ');
  return {
    kind: 'upcoming_earnings',
    severity: 'medium',
    title: 'Upcoming earnings',
    detail: `Earnings within the next 7 days: ${list}.`,
  };
}

function buildNewsExposureSignal(newsOutcomes: RunOutcome[], nowMs: number): RiskSignal | null {
  let recent = 0;
  for (const outcome of newsOutcomes) {
    if (!outcome?.result) continue;
    const items = outcome.result.data;
    if (!isNewsItemArray(items)) continue;
    for (const item of items) {
      if (item.timestamp * 1000 >= nowMs - NEWS_RECENT_MS) recent += 1;
    }
  }

  if (recent === 0) return null;
  const severity: RiskSeverity = recent >= 4 ? 'medium' : 'low';
  const plural = recent === 1 ? '' : 's';
  return {
    kind: 'news_exposure',
    severity,
    title: 'News exposure',
    detail: `${recent} recent news item${plural} across top positions in the last 7 days.`,
  };
}

function buildDrawdownSignals(
  allocation: AllocationItem[],
  klineOutcomes: RunOutcome[]
): RiskSignal[] {
  const signals: RiskSignal[] = [];
  allocation.forEach((item, index) => {
    const outcome = klineOutcomes[index];
    if (!outcome?.result) return;
    const klines = outcome.result.data;
    if (!isKlineArray(klines) || klines.length === 0) return;

    const window = klines.slice(-DRAWDOWN_WINDOW_BARS);
    let peakHigh = 0;
    for (const bar of window) if (bar.high > peakHigh) peakHigh = bar.high;
    const lastClose = window[window.length - 1]?.close;
    if (!peakHigh || !lastClose) return;

    const drawdown = (peakHigh - lastClose) / peakHigh;
    if (drawdown > 0.35) {
      signals.push({
        kind: 'drawdown',
        severity: 'high',
        symbol: item.symbol,
        title: `Sharp drawdown: ${item.symbol}`,
        detail: `${item.symbol} is ${pct(drawdown)} below its ${DRAWDOWN_WINDOW_BARS}-day high.`,
      });
    } else if (drawdown > 0.2) {
      signals.push({
        kind: 'drawdown',
        severity: 'medium',
        symbol: item.symbol,
        title: `Drawdown: ${item.symbol}`,
        detail: `${item.symbol} is ${pct(drawdown)} below its ${DRAWDOWN_WINDOW_BARS}-day high.`,
      });
    }
  });
  return signals;
}

function buildSectorExposureSignal(
  allocation: AllocationItem[],
  profileOutcomes: RunOutcome[]
): RiskSignal | null {
  const sectorWeights = new Map<string, number>();
  let unknown = 0;

  allocation.forEach((item, index) => {
    const sector = readSector(profileOutcomes[index]?.result?.data);
    if (sector) {
      sectorWeights.set(sector, (sectorWeights.get(sector) ?? 0) + item.weight);
    } else {
      unknown += 1;
    }
  });

  if (sectorWeights.size === 0) return null;

  let topSector = '';
  let topWeight = 0;
  for (const [sector, weight] of sectorWeights) {
    if (weight > topWeight) {
      topWeight = weight;
      topSector = sector;
    }
  }

  if (topWeight > 0.5) {
    return {
      kind: 'sector_exposure',
      severity: 'high',
      title: `Sector concentration: ${topSector}`,
      detail: sectorDetail(topSector, topWeight, unknown),
    };
  }
  if (topWeight > 0.3) {
    return {
      kind: 'sector_exposure',
      severity: 'medium',
      title: `Sector concentration: ${topSector}`,
      detail: sectorDetail(topSector, topWeight, unknown),
    };
  }
  return null;
}

// ── Deterministic local synthesizer ────────────────────────────────────────

export const defaultPortfolioRiskSynthesizer: PortfolioRiskSynthesizer = async (input) => {
  const { allocation, concentration, signals, capabilityRuns } = input;
  if (allocation.length === 0) {
    return 'Portfolio risk analysis could not be completed: no position data was available.';
  }

  const parts: string[] = [
    `Portfolio holds ${allocation.length} position${allocation.length === 1 ? '' : 's'}; ` +
      `top position ${pct(concentration.top1Weight)}, top-five ${pct(concentration.top5Weight)}, ` +
      `Herfindahl ${concentration.herfindahl.toFixed(3)}.`,
  ];

  if (signals.length === 0) {
    parts.push('No material risk signals detected.');
  } else {
    const high = signals.filter((s) => s.severity === 'high');
    const medium = signals.filter((s) => s.severity === 'medium');
    if (high.length > 0) parts.push(`High: ${high.map((s) => s.title).join('; ')}.`);
    if (medium.length > 0) parts.push(`Medium: ${medium.map((s) => s.title).join('; ')}.`);
  }

  const partial = capabilityRuns.filter((r) => r.status !== 'success');
  if (partial.length > 0) {
    const ids = partial.map((r) => r.capabilityId).join(', ');
    parts.push(`Partial data: ${partial.length} capability run(s) unavailable (${ids}).`);
  }

  return parts.join(' ');
};

// ── Boundary guards for capability result data (typed at source, `unknown`
//    after the executor erases the generic) ─────────────────────────────────

interface CalendarEvent {
  symbol?: string;
  type?: string;
  date?: string | number;
}

function isPortfolioSnapshot(value: unknown): value is PortfolioSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  return 'holdings' in value && Array.isArray(value.holdings);
}

function isHolding(value: unknown): value is Holding {
  if (typeof value !== 'object' || value === null) return false;
  return 'symbol' in value && typeof value.symbol === 'string';
}

function isHoldingArray(value: unknown): value is Holding[] {
  return Array.isArray(value) && value.every(isHolding);
}

function isQuote(value: unknown): value is Quote {
  if (typeof value !== 'object' || value === null) return false;
  return 'lastPrice' in value && typeof value.lastPrice === 'number';
}

function isKline(value: unknown): value is Kline {
  if (typeof value !== 'object' || value === null) return false;
  return (
    'high' in value &&
    typeof value.high === 'number' &&
    'close' in value &&
    typeof value.close === 'number'
  );
}

function isKlineArray(value: unknown): value is Kline[] {
  return Array.isArray(value) && value.every(isKline);
}

function isNewsItem(value: unknown): value is NewsItem {
  if (typeof value !== 'object' || value === null) return false;
  return 'timestamp' in value && typeof value.timestamp === 'number';
}

function isNewsItemArray(value: unknown): value is NewsItem[] {
  return Array.isArray(value) && value.every(isNewsItem);
}

function isCalendarEvent(value: unknown): value is CalendarEvent {
  if (typeof value !== 'object' || value === null) return false;
  if ('symbol' in value && typeof value.symbol !== 'string') return false;
  if ('type' in value && typeof value.type !== 'string') return false;
  if ('date' in value) {
    const date = value.date;
    if (typeof date !== 'string' && typeof date !== 'number') return false;
  }
  return true;
}

function extractEvents(data: unknown): CalendarEvent[] {
  if (typeof data !== 'object' || data === null || !('events' in data)) return [];
  const events = data.events;
  return Array.isArray(events) ? events.filter(isCalendarEvent) : [];
}

/** Read an optional `sector` string from company.profile data, if present. */
function readSector(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || !('sector' in value)) return undefined;
  const sector = value.sector;
  return typeof sector === 'string' && sector.length > 0 ? sector : undefined;
}

/** Parse a calendar date (epoch seconds/ms or ISO string) into epoch ms. */
function toEpochMs(date: string | number | undefined): number | undefined {
  if (date === undefined || date === null) return undefined;
  if (typeof date === 'number') return date > 1e11 ? date : date * 1000;
  const parsed = Date.parse(date);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function toRunEntry(record: CapabilityRunRecord): CapabilityRunEntry {
  return {
    capabilityId: record.capabilityId,
    status: record.status,
    ...(record.error ? { error: record.error } : {}),
  };
}

function missingRun(capabilityId: string): CapabilityRunEntry {
  return { capabilityId, status: 'unavailable', error: 'capability not registered' };
}

function byWeightDesc(a: AllocationItem, b: AllocationItem): number {
  if (b.weight !== a.weight) return b.weight - a.weight;
  return a.symbol.localeCompare(b.symbol);
}

function sectorDetail(sector: string, weight: number, unknown: number): string {
  const base = `${sector} accounts for ${pct(weight)} of the portfolio.`;
  if (unknown > 0) {
    return `${base} ${unknown} position${unknown === 1 ? '' : 's'} without sector data excluded.`;
  }
  return base;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
