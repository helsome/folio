import { randomUUID } from 'node:crypto';
import type {
  AlertRule,
  AlertTriggerEvent,
  CapabilityId,
  CapabilityRegistry,
  MarketStatus,
  NewsItem,
  PortfolioSnapshot,
  Quote,
  SymbolAlertRuleBase,
} from '@finagent/core';
import type { AlertRuleSnapshot } from './rules-repository.ts';

/**
 * Per-rule evaluators. Each turns one `AlertRule` + the capability registry
 * into an `AlertTriggerEvent` (or `null` when the condition is not met, the
 * capability is missing, or the result is empty). Missing capabilities degrade
 * to `null`; capability execution errors propagate to the engine, which
 * isolates per-rule failures.
 *
 * Unit convention: capability `data` timestamps are epoch SECONDS (the
 * Longbridge CLI convention, matching `Quote.timestamp` / `NewsItem.timestamp`);
 * rule fields (`lastCheckedAt`, `lastTriggeredAt`, `now()`) are epoch MILLISECONDS
 * per the `@finagent/core` contract. Evaluators convert seconds→ms before
 * comparing against rule cursors.
 */

const SECOND_MS = 1000;
const DAY_MS = 86_400_000;

/** State access a rule's evaluation may need (time + cross-tick memory). */
export interface AlertEvaluatorContext {
  now: () => number;
  getRuleSnapshot: (ruleId: string) => Promise<AlertRuleSnapshot>;
  patchRuleSnapshot: (ruleId: string, patch: Partial<AlertRuleSnapshot>) => Promise<AlertRuleSnapshot>;
}

// Standalone fallback: in-memory snapshots + wall clock. The engine injects a
// persistent (repository-backed) context.
const memorySnapshots = new Map<string, AlertRuleSnapshot>();
const DEFAULT_CONTEXT: AlertEvaluatorContext = {
  now: Date.now,
  getRuleSnapshot: async (ruleId) => memorySnapshots.get(ruleId) ?? {},
  patchRuleSnapshot: async (ruleId, patch) => {
    const next = { ...(memorySnapshots.get(ruleId) ?? {}), ...patch };
    memorySnapshots.set(ruleId, next);
    return next;
  },
};

// ── Capability data shapes (contract with the phase-two manifests) ──────────

/** `company.ratings` → `InstitutionRating` (subset the evaluator reads). */
export interface RatingData {
  recommend?: string;
  target?: number;
  updatedAt?: number;
}

/** `company.dividends` → `DividendRecord[]` (subset; no yield from the CLI). */
export interface DividendRecordData {
  exDate: number; // epoch seconds
  yield?: number;
}

/** `research.events` → `CalendarEvent[]` (subset). */
export interface CalendarEventData {
  date: number; // epoch seconds
  type?: string; // raw calendar type; earnings announcements carry 'financial'
  symbol?: string;
}

/** `portfolio.positions` → raw account holdings (no market value). */
export interface RawHoldingData {
  symbol: string;
  quantity?: number | string;
  costPrice?: number | string;
  market?: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function run<T>(
  registry: CapabilityRegistry,
  id: CapabilityId,
  input: unknown,
  now: () => number
): Promise<T | null> {
  const capability = registry.get(id);
  if (!capability) return null;
  const result = await capability.execute(input, { now });
  return (result?.data ?? null) as T | null;
}

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function sameSymbol(a: string, b: string): boolean {
  return normalizeSymbol(a) === normalizeSymbol(b);
}

/** Epoch seconds → epoch ms. */
function secondsToMs(seconds: number): number {
  return seconds * SECOND_MS;
}

function ruleSymbol(rule: AlertRule): string | undefined {
  if (rule.type === 'portfolio_drawdown') return undefined;
  return (rule as SymbolAlertRuleBase).symbol;
}

function makeEvent(
  rule: AlertRule,
  triggeredAt: number,
  partial: { title: string; message: string; payload?: Record<string, unknown> }
): AlertTriggerEvent {
  return {
    id: randomUUID(),
    ruleId: rule.id,
    ruleType: rule.type,
    ...(ruleSymbol(rule) !== undefined ? { symbol: ruleSymbol(rule) } : {}),
    triggeredAt,
    title: partial.title,
    message: partial.message,
    payload: partial.payload,
  };
}

/** Map a symbol to the exchange code used by `market.status`. */
export function marketForSymbol(symbol: string): string {
  const suffix = symbol.includes('.') ? symbol.split('.').pop()!.toUpperCase() : '';
  switch (suffix) {
    case 'US':
      return 'US';
    case 'HK':
    case 'HAS':
      return 'HK';
    case 'SH':
    case 'SZ':
      return 'CN';
    case 'SG':
      return 'SG';
    default:
      return 'US';
  }
}

export function isMarketOpen(statuses: MarketStatus[], market: string): boolean {
  const entry = statuses.find((s) => s.market.toUpperCase() === market.toUpperCase());
  if (!entry) return false;
  return entry.status.trim().toLowerCase() !== 'closed';
}

export function isAnyMarketOpen(statuses: MarketStatus[]): boolean {
  return statuses.some((s) => s.status.trim().toLowerCase() !== 'closed');
}

/** Canonical rating summary: `<consensus>@<target>` (e.g. `strong_buy@302.83`). */
function ratingSummary(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const recommend =
    typeof d.recommend === 'string' ? d.recommend : typeof d.rating === 'string' ? d.rating : undefined;
  const target =
    typeof d.target === 'number' ? d.target : typeof d.targetPrice === 'number' ? d.targetPrice : undefined;
  if (!recommend && target === undefined) return null;
  return [recommend, target !== undefined ? String(target) : undefined]
    .filter((part): part is string => part !== undefined)
    .join('@');
}

// ── Evaluators ──────────────────────────────────────────────────────────────

async function evaluatePrice(
  rule: Extract<AlertRule, { type: 'price_above' | 'price_below' }>,
  registry: CapabilityRegistry,
  ctx: AlertEvaluatorContext
): Promise<AlertTriggerEvent | null> {
  const quote = await run<Quote>(registry, 'market.quote', { symbol: rule.symbol }, ctx.now);
  if (!quote || typeof quote.lastPrice !== 'number') return null;
  const lastPrice = quote.lastPrice;
  const targetPrice = rule.targetPrice;
  const crossed = rule.type === 'price_above' ? lastPrice > targetPrice : lastPrice < targetPrice;
  if (!crossed) return null;
  const direction = rule.type === 'price_above' ? 'above' : 'below';
  return makeEvent(rule, ctx.now(), {
    title: `${rule.symbol} crossed ${direction} $${targetPrice.toFixed(2)}`,
    message: `Last price $${lastPrice.toFixed(2)} crossed ${direction} target $${targetPrice.toFixed(2)}.`,
    payload: { price: lastPrice, targetPrice },
  });
}

async function evaluateNews(
  rule: Extract<AlertRule, { type: 'new_news' }>,
  registry: CapabilityRegistry,
  ctx: AlertEvaluatorContext
): Promise<AlertTriggerEvent | null> {
  const items = await run<NewsItem[]>(registry, 'research.news', { symbol: rule.symbol }, ctx.now);
  if (!items || items.length === 0) return null;
  const cursorMs = rule.lastCheckedAt ?? rule.lastTriggeredAt ?? 0;
  const fresh = items
    .filter((item) => secondsToMs(item.timestamp) > cursorMs)
    .sort((a, b) => b.timestamp - a.timestamp);
  if (fresh.length === 0) return null;
  const newest = fresh.slice(0, 3).map((item) => ({ id: item.id, title: item.title }));
  return makeEvent(rule, ctx.now(), {
    title: `${rule.symbol}: ${fresh.length} new headline${fresh.length === 1 ? '' : 's'}`,
    message: newest.map((n) => n.title).join(' | '),
    payload: { items: newest },
  });
}

async function evaluateEarnings(
  rule: Extract<AlertRule, { type: 'earnings' }>,
  registry: CapabilityRegistry,
  ctx: AlertEvaluatorContext
): Promise<AlertTriggerEvent | null> {
  const events = await run<CalendarEventData[]>(
    registry,
    'research.events',
    { eventType: 'financial', symbols: [rule.symbol] },
    ctx.now
  );
  if (!events || events.length === 0) return null;
  const now = ctx.now();
  const horizonEnd = now + rule.horizonDays * DAY_MS;
  const upcoming = events
    .filter((event) => (event.type ?? 'financial').toLowerCase() === 'financial')
    .filter((event) => !event.symbol || sameSymbol(event.symbol, rule.symbol))
    .filter((event) => {
      const dateMs = secondsToMs(event.date);
      return dateMs >= now && dateMs <= horizonEnd;
    })
    .sort((a, b) => a.date - b.date);
  if (upcoming.length === 0) return null;
  const next = upcoming[0];
  return makeEvent(rule, now, {
    title: `${rule.symbol} earnings upcoming`,
    message: `Earnings expected ${new Date(secondsToMs(next.date)).toLocaleDateString()}.`,
    payload: { date: secondsToMs(next.date) },
  });
}

async function evaluateRatingChange(
  rule: Extract<AlertRule, { type: 'rating_change' }>,
  registry: CapabilityRegistry,
  ctx: AlertEvaluatorContext
): Promise<AlertTriggerEvent | null> {
  const data = await run<RatingData>(registry, 'company.ratings', { symbol: rule.symbol }, ctx.now);
  const summary = ratingSummary(data);
  if (!summary) return null;
  const previous = (await ctx.getRuleSnapshot(rule.id)).ratingSummary;
  if (previous === undefined) {
    // First observation — record a baseline, do not trigger.
    await ctx.patchRuleSnapshot(rule.id, { ratingSummary: summary });
    return null;
  }
  if (previous === summary) return null;
  await ctx.patchRuleSnapshot(rule.id, { ratingSummary: summary });
  return makeEvent(rule, ctx.now(), {
    title: `${rule.symbol} rating change`,
    message: `Consensus rating moved from ${previous} to ${summary}.`,
    payload: { previous, current: summary },
  });
}

async function evaluateDividend(
  rule: Extract<AlertRule, { type: 'dividend' }>,
  registry: CapabilityRegistry,
  ctx: AlertEvaluatorContext
): Promise<AlertTriggerEvent | null> {
  const records = await run<DividendRecordData[]>(
    registry,
    'company.dividends',
    { symbol: rule.symbol },
    ctx.now
  );
  if (!records || records.length === 0) return null;
  const now = ctx.now();
  const windowEnd = now + 7 * DAY_MS;
  const upcoming = records
    .filter((record) => {
      const exDateMs = secondsToMs(record.exDate);
      return exDateMs >= now && exDateMs <= windowEnd;
    })
    .sort((a, b) => a.exDate - b.exDate);
  if (upcoming.length === 0) return null;
  const next = upcoming[0];
  return makeEvent(rule, now, {
    title: `${rule.symbol} ex-dividend upcoming`,
    message: `Ex-dividend date ${new Date(secondsToMs(next.exDate)).toLocaleDateString()}.`,
    payload: { exDate: secondsToMs(next.exDate) },
  });
}

async function evaluatePositionWeight(
  rule: Extract<AlertRule, { type: 'position_weight' }>,
  registry: CapabilityRegistry,
  ctx: AlertEvaluatorContext
): Promise<AlertTriggerEvent | null> {
  const summary = await run<PortfolioSnapshot>(registry, 'portfolio.summary', {}, ctx.now);
  if (!summary || typeof summary.totalAssets !== 'number' || summary.totalAssets <= 0) return null;

  const rawPositions = await run<RawHoldingData[]>(registry, 'portfolio.positions', {}, ctx.now);

  // Market value comes from `portfolio.summary` (enriched holdings); the raw
  // `portfolio.positions` holding confirms the symbol is actually in the book.
  const enriched = summary.holdings.find((p) => sameSymbol(p.symbol, rule.symbol));
  const held =
    enriched !== undefined || (rawPositions?.some((p) => sameSymbol(p.symbol, rule.symbol)) ?? false);
  if (!held) return null;
  const holdingValue = enriched ? (enriched.marketValueBase ?? enriched.marketValue) : undefined;
  if (typeof holdingValue !== 'number') return null; // held, value unknown

  const weight = holdingValue / summary.totalAssets;
  const minWeight = rule.minWeight ?? 0;
  const maxWeight = rule.maxWeight ?? Infinity;
  if (weight >= minWeight && weight <= maxWeight) return null;

  const maxLabel = maxWeight === Infinity ? '∞' : `${(maxWeight * 100).toFixed(1)}%`;
  return makeEvent(rule, ctx.now(), {
    title: `${rule.symbol} position weight out of bounds`,
    message: `Weight ${(weight * 100).toFixed(1)}% is outside [${(minWeight * 100).toFixed(1)}%, ${maxLabel}].`,
    payload: { weight },
  });
}

async function evaluateDrawdown(
  rule: Extract<AlertRule, { type: 'portfolio_drawdown' }>,
  registry: CapabilityRegistry,
  ctx: AlertEvaluatorContext
): Promise<AlertTriggerEvent | null> {
  const summary = await run<PortfolioSnapshot>(registry, 'portfolio.summary', {}, ctx.now);
  if (!summary || typeof summary.totalAssets !== 'number' || summary.totalAssets <= 0) return null;
  const current = summary.totalAssets;
  const snapshot = await ctx.getRuleSnapshot(rule.id);
  let peak = snapshot.peakValue ?? current;
  if (current > peak) {
    // New high-water mark — reset the peak, no drawdown.
    await ctx.patchRuleSnapshot(rule.id, { peakValue: current });
    return null;
  }
  const drawdown = (peak - current) / peak;
  if (drawdown <= rule.threshold) return null;
  const currency = summary.baseCurrency ?? 'USD';
  const fmt = new Intl.NumberFormat(undefined, { style: 'currency', currency });
  return makeEvent(rule, ctx.now(), {
    title: 'Portfolio drawdown alert',
    message: `Drawdown ${(drawdown * 100).toFixed(1)}% from peak ${fmt.format(peak)}.`,
    payload: { drawdown, peak, currency },
  });
}

/**
 * Evaluate a single rule against the registry, returning a trigger event when
 * the condition fires or `null` otherwise. Never throws on missing/empty data;
 * capability execution errors propagate (the engine isolates them per rule).
 */
export async function evaluateRule(
  rule: AlertRule,
  registry: CapabilityRegistry,
  context: Partial<AlertEvaluatorContext> = {}
): Promise<AlertTriggerEvent | null> {
  const ctx: AlertEvaluatorContext = { ...DEFAULT_CONTEXT, ...context };
  switch (rule.type) {
    case 'price_above':
    case 'price_below':
      return evaluatePrice(rule, registry, ctx);
    case 'new_news':
      return evaluateNews(rule, registry, ctx);
    case 'earnings':
      return evaluateEarnings(rule, registry, ctx);
    case 'rating_change':
      return evaluateRatingChange(rule, registry, ctx);
    case 'dividend':
      return evaluateDividend(rule, registry, ctx);
    case 'position_weight':
      return evaluatePositionWeight(rule, registry, ctx);
    case 'portfolio_drawdown':
      return evaluateDrawdown(rule, registry, ctx);
  }
}

export type { AlertRuleSnapshot };
