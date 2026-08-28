import type { TFunction } from 'i18next';
import type {
  CalendarEvent,
  Holding,
  PortfolioAccount,
  PortfolioSnapshot,
  Quote,
  ScreeningCandidate,
} from '@finagent/core';
import type { DailyBrief } from '../client/automation';
import type { MarketPulseSnapshot } from '../client/pulse';

/**
 * Built-in sample ("demo") content.
 *
 * Used as the default display data when the app is NOT connected to a live
 * market-data provider (LongBridge/Massive) or an LLM runtime. Every surface
 * that falls back to this data MUST render a `DemoBadge` ("Sample data") so
 * sample content is never mistaken for live data. Sample values mirror the
 * Stitch "Minimalist Personal Portfolio" design explorations.
 *
 * Pure data + pure functions: no client calls, no clock writes — the only
 * time-dependence is relative event/brief timestamps so demo content never
 * looks stale.
 */

/** Round to 2 decimals without float drift. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Static spec per demo symbol (prices mirror the Stitch designs). */
interface DemoQuoteSpec {
  lastPrice: number;
  changePercent: number;
  volume: number;
}

const DEMO_QUOTE_SPECS: Record<string, DemoQuoteSpec> = {
  'AAPL.US': { lastPrice: 189.43, changePercent: 1.2, volume: 52_400_000 },
  'TSLA.US': { lastPrice: 175.22, changePercent: -2.1, volume: 98_100_000 },
  'NVDA.US': { lastPrice: 880.12, changePercent: 4.2, volume: 41_300_000 },
  'MSFT.US': { lastPrice: 412.6, changePercent: 1.8, volume: 22_700_000 },
  'AMZN.US': { lastPrice: 132.45, changePercent: 0.8, volume: 38_900_000 },
  'GOOGL.US': { lastPrice: 138.9, changePercent: -1.2, volume: 26_500_000 },
  'META.US': { lastPrice: 318.65, changePercent: -0.5, volume: 14_800_000 },
};

const DEMO_SYMBOL_NAMES: Record<string, string> = {
  'AAPL.US': 'Apple Inc.',
  'TSLA.US': 'Tesla, Inc.',
  'NVDA.US': 'NVIDIA Corporation',
  'MSFT.US': 'Microsoft Corporation',
  'AMZN.US': 'Amazon.com, Inc.',
  'GOOGL.US': 'Alphabet Inc.',
  'META.US': 'Meta Platforms, Inc.',
};

/** True when the symbol has built-in sample data. */
export function hasDemoQuote(symbol: string): boolean {
  return symbol != null && Object.prototype.hasOwnProperty.call(DEMO_QUOTE_SPECS, symbol);
}

/**
 * A sample `Quote` for the symbol, or `null` when none exists. `timestamp` is
 * "now" (epoch seconds) so freshness lines never read as stale.
 */
export function demoQuote(symbol: string, nowMs: number = Date.now()): Quote | null {
  const spec = DEMO_QUOTE_SPECS[symbol];
  if (spec == null) return null;
  const prevClose = round2(spec.lastPrice / (1 + spec.changePercent / 100));
  const change = round2(spec.lastPrice - prevClose);
  return {
    symbol,
    lastPrice: spec.lastPrice,
    change,
    changePercent: spec.changePercent,
    volume: spec.volume,
    timestamp: Math.floor(nowMs / 1000),
    high: round2(spec.lastPrice * 1.004),
    low: round2(prevClose * 0.995),
    open: round2(prevClose * 1.002),
    prevClose,
  };
}

interface DemoHoldingSpec {
  symbol: string;
  quantity: number;
  costPrice: number;
}

/** Holdings proportions echo the Stitch "Portfolio Analytics" exploration. */
const DEMO_HOLDING_SPECS: DemoHoldingSpec[] = [
  { symbol: 'AAPL.US', quantity: 120, costPrice: 142.5 },
  { symbol: 'MSFT.US', quantity: 35, costPrice: 288.4 },
  { symbol: 'NVDA.US', quantity: 60, costPrice: 402.1 },
  { symbol: 'JPM.US', quantity: 80, costPrice: 141.3 },
];

const DEMO_CASH = 23_500;

/**
 * A complete sample portfolio snapshot at personal scale. Holdings are priced
 * from `demoQuote` (JPM gets its own inline spec because it is not on the
 * default watchlist), so every derived number is internally consistent.
 */
export function demoPortfolioSnapshot(nowMs: number = Date.now()): PortfolioSnapshot {
  const specs: DemoHoldingSpec[] = [
    ...DEMO_HOLDING_SPECS,
  ];
  const jpmLast = 192.15;
  const jpmPrev = 191.38;

  const holdings: Holding[] = specs.map((spec) => {
    const isJpm = spec.symbol === 'JPM.US';
    const quote = isJpm
      ? {
          lastPrice: jpmLast,
          prevClose: jpmPrev,
          changePercent: round2((jpmLast - jpmPrev) / jpmPrev * 100),
        }
      : demoQuote(spec.symbol, nowMs)!;
    const marketValue = round2(quote.lastPrice * spec.quantity);
    const cost = round2(spec.costPrice * spec.quantity);
    const pnl = round2(marketValue - cost);
    return {
      symbol: spec.symbol,
      name: DEMO_SYMBOL_NAMES[spec.symbol] ?? spec.symbol,
      currency: 'USD',
      quantity: spec.quantity,
      availableQuantity: spec.quantity,
      costPrice: spec.costPrice,
      marketPrice: quote.lastPrice,
      marketValue,
      marketValueBase: marketValue,
      unrealizedPnL: pnl,
      unrealizedPnLPercent: round2(pnl / cost * 100),
      prevClose: quote.prevClose,
    };
  });

  const marketValue = round2(holdings.reduce((sum, holding) => sum + (holding.marketValue ?? 0), 0));
  const totalPnL = round2(holdings.reduce((sum, holding) => sum + (holding.unrealizedPnL ?? 0), 0));
  const todayPnL = round2(
    holdings.reduce(
      (sum, holding) => sum + ((holding.marketPrice ?? 0) - (holding.prevClose ?? 0)) * (holding.quantity ?? 0),
      0,
    ),
  );
  const totalAssets = round2(marketValue + DEMO_CASH);

  const account: PortfolioAccount = {
    id: 'demo-account',
    name: 'Sample Account',
    market: 'US',
    currency: 'USD',
    netAssets: totalAssets,
    marketValue,
    cash: DEMO_CASH,
    pnl: totalPnL,
    todayPnL,
  };

  return {
    baseCurrency: 'USD',
    totalAssets,
    marketValue,
    cash: DEMO_CASH,
    totalPnL,
    todayPnL,
    riskLevel: 'Medium',
    accounts: [account],
    holdings,
    fetchedAt: nowMs,
    marketTime: nowMs,
  };
}

/** A future local date+offset as epoch seconds. */
function futureDate(daysFromNow: number, hour: number, minute: number, nowMs: number = Date.now()): Date {
  const date = new Date(nowMs);
  date.setDate(date.getDate() + daysFromNow);
  date.setHours(hour, minute, 0, 0);
  return date;
}

/** `YYYY-MM-DD` in local time. */
function localDateKey(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Sample upcoming calendar events (always strictly in the future relative to
 * `nowMs`, so `mapUpcomingEvents` keeps them).
 */
export function demoCalendarEvents(t: TFunction, nowMs: number = Date.now()): CalendarEvent[] {
  const earnings = futureDate(2, 17, 0, nowMs);
  const pce = futureDate(4, 8, 30, nowMs);
  const fomc = futureDate(6, 14, 0, nowMs);
  return [
    {
      id: 'demo-event-aapl-earnings',
      date: Math.floor(earnings.getTime() / 1000),
      type: 'report',
      symbol: 'AAPL.US',
      name: t('demo.events.earningsName'),
      content: t('demo.events.earningsContent'),
      localDate: localDateKey(earnings),
    },
    {
      id: 'demo-event-pce',
      date: Math.floor(pce.getTime() / 1000),
      type: 'macrodata',
      symbol: '',
      name: t('demo.events.macroName'),
      content: t('demo.events.macroContent'),
      localDate: localDateKey(pce),
    },
    {
      id: 'demo-event-fomc',
      date: Math.floor(fomc.getTime() / 1000),
      type: 'macrodata',
      symbol: '',
      name: t('demo.events.fomcName'),
      content: t('demo.events.fomcContent'),
      localDate: localDateKey(fomc),
    },
  ];
}

/**
 * Sample daily brief used when the automation/LLM runtime is unavailable —
 * the two headline items mirror the Stitch Today dashboard exploration.
 */
export function demoDailyBrief(t: TFunction, nowMs: number = Date.now()): DailyBrief {
  return {
    generatedAt: nowMs,
    items: [
      {
        id: 'demo-brief-risk',
        symbol: 'AAPL.US',
        title: t('demo.brief.riskTitle'),
        message: t('demo.brief.riskMessage'),
        source: 'Portfolio',
        severity: 'warning',
      },
      {
        id: 'demo-brief-rotation',
        title: t('demo.brief.rotationTitle'),
        message: t('demo.brief.rotationMessage'),
        source: 'Watchlist',
        severity: 'info',
      },
    ],
    summary: t('demo.brief.summary'),
    quiet: { count: 2, message: t('demo.brief.quiet') },
  };
}

function demoMover(symbol: string, changePercent: number): ScreeningCandidate {
  return {
    symbol,
    name: DEMO_SYMBOL_NAMES[symbol] ?? symbol,
    market: 'US',
    reasons: [],
    metrics: { changePercent },
    evidence: [],
  };
}

/**
 * Sample market-pulse snapshot for when the `pulse:snapshot` channel is
 * missing or fails. Index prices echo the Stitch Markets exploration; movers
 * reuse the demo quote set. Temperature label is intentionally omitted
 * (language-neutral; the chip renders the score alone).
 */
export function demoPulseSnapshot(nowMs: number = Date.now()): MarketPulseSnapshot {
  return {
    indices: [
      { symbol: 'SPX.US', name: 'S&P 500', lastPrice: 5123.45, changePercent: 1.24 },
      { symbol: 'NDX.US', name: 'NASDAQ', lastPrice: 16234.12, changePercent: 1.85 },
      { symbol: 'HSI.HK', name: 'Hang Seng', lastPrice: 7932.8, changePercent: -0.45 },
    ],
    marketStatus: [
      { market: 'US', status: 'open' },
      { market: 'HK', status: 'closed' },
    ],
    temperature: { score: 62, market: 'US' },
    movers: [
      demoMover('NVDA.US', 4.2),
      demoMover('AMZN.US', 0.8),
      demoMover('TSLA.US', -2.1),
      demoMover('GOOGL.US', -1.2),
    ],
    personalImpact: {
      scope: 'watchlist',
      items: [
        { symbol: 'NVDA.US', changePercent: 4.2, watchlistExposurePercent: 33.3, impact: 'positive' },
        { symbol: 'TSLA.US', changePercent: -2.1, watchlistExposurePercent: 33.3, impact: 'negative' },
      ],
    },
    failures: [],
    generatedAt: nowMs,
  };
}
