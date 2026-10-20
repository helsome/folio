import type {
  CapabilityProvenance,
  CapabilityRegistry,
  Comparison,
  ComparisonCell,
  ComparisonRow,
} from '@finagent/core';
import { CapabilityExecutor, type RunAllSpec } from '../capabilities/executor.ts';
import { isRecord, toFiniteNumber } from '../guards.ts';

const DASH = '\u2014';

/**
 * Capabilities that feed the comparison table. A capability absent from the
 * registry (or a failed run) degrades to a missing cell — data is NEVER
 * inferred from a sibling metric.
 */
const COMPARE_CAPABILITY_IDS = [
  'market.quote',
  'company.valuation',
  'company.financials',
  'company.dividends',
  'market.kline',
  'company.ratings',
] as const;

const KLINE_LIMIT = 260;

/**
 * Return windows as trading-day offsets from the latest bar: 1M ≈ 21 sessions,
 * 3M ≈ 63, 1Y ≈ 252. A window needs `days + 1` bars; with `limit: 260` a daily
 * series covers all three.
 */
const RETURN_WINDOWS = { '1M': 21, '3M': 63, '1Y': 252 } as const;

const RATING_LABELS: Record<string, string> = {
  buy: 'Buy',
  strong_buy: 'Buy',
  overweight: 'Buy',
  outperform: 'Buy',
  sell: 'Sell',
  strong_sell: 'Sell',
  underweight: 'Sell',
  underperform: 'Sell',
  hold: 'Neutral',
  neutral: 'Neutral',
  equal_weight: 'Neutral',
};

/**
 * Canonical data contracts consumed from the phase-2 manifests. Absent fields
 * degrade to missing cells; the Longbridge expansion (B) aligns its normalized
 * shapes to these field names.
 */
interface FinancialReportData {
  revenueGrowth?: number; // % YoY
  grossMargin?: number; // %
  roe?: number; // %
}

interface DividendData {
  dividendYield?: number; // trailing %
}

export interface CompareOptions {
  executor?: CapabilityExecutor;
  now?: () => number;
}

/**
 * Build a cross-symbol `Comparison` from registry calls. Per-symbol fetch
 * failures are recorded in `errors` (rows still render with missing cells).
 */
export async function buildComparison(
  symbols: string[],
  registry: CapabilityRegistry,
  options: CompareOptions = {}
): Promise<Comparison> {
  const executor = options.executor ?? new CapabilityExecutor({ now: options.now });
  const now = options.now ?? Date.now;

  const specs: RunAllSpec[] = [];
  for (const symbol of symbols) {
    for (const id of COMPARE_CAPABILITY_IDS) {
      const cap = registry.get(id);
      if (!cap) continue;
      specs.push({
        cap,
        input: id === 'market.kline' ? { symbol, period: '1d', limit: KLINE_LIMIT } : { symbol },
      });
    }
  }

  const outcomes = await executor.runAll(specs, { concurrency: 4, timeoutMs: 20_000 });

  const perSymbol: Record<string, Record<string, unknown>> = Object.fromEntries(
    symbols.map((symbol) => [symbol, {}])
  );
  // Same shape as `perSymbol`, holding the provenance of each successful
  // capability result so cells can name the actual source (#332).
  const perSymbolProvenance: Record<string, Record<string, CapabilityProvenance>> = Object.fromEntries(
    symbols.map((symbol) => [symbol, {}])
  );
  const errors: Record<string, string> = {};

  for (let i = 0; i < specs.length; i += 1) {
    const outcome = outcomes[i];
    if (!outcome) continue;
    const symbol = (specs[i].input as { symbol: string }).symbol;
    if (outcome.record.status !== 'success' || !outcome.result) {
      if (!errors[symbol]) {
        errors[symbol] = outcome.record.error ?? `${outcome.record.capabilityId} fetch failed`;
      }
      continue;
    }
    perSymbol[symbol][outcome.record.capabilityId] = outcome.result.data;
    if (outcome.result.provenance) {
      perSymbolProvenance[symbol][outcome.record.capabilityId] = outcome.result.provenance;
    }
  }

  const sources = collectSources(perSymbol);
  return {
    symbols,
    rows: buildRows(symbols, perSymbol, perSymbolProvenance),
    generatedAt: now(),
    errors,
    ...(sources.names.length > 0 ? { sources: sources.names, delayed: sources.delayed } : {}),
  };
}

function collectSources(perSymbol: Record<string, Record<string, unknown>>): {
  names: string[];
  delayed: boolean;
} {
  const names: string[] = [];
  let delayed = false;
  for (const data of Object.values(perSymbol)) {
    for (const capabilityId of ['market.quote', 'market.kline'] as const) {
      const source = readMarketSource(data[capabilityId]);
      if (!source) continue;
      if (!names.includes(source.name)) names.push(source.name);
      if (source.delayed) delayed = true;
    }
  }
  return { names, delayed };
}

function readMarketSource(data: unknown): { name: string; delayed: boolean } | undefined {
  const records = Array.isArray(data) ? data : [data];
  for (const record of records) {
    if (!isRecord(record) || !isRecord(record.source)) continue;
    const name = record.source.providerName;
    if (typeof name !== 'string' || name.trim() === '') continue;
    return { name, delayed: record.source.delayed === true };
  }
  return undefined;
}

function buildRows(
  symbols: string[],
  perSymbol: Record<string, Record<string, unknown>>,
  perSymbolProvenance: Record<string, Record<string, CapabilityProvenance>>
): ComparisonRow[] {
  const rows: ComparisonRow[] = [];

  const quoteRow = row('Price');
  const marketCapRow = row('Market Cap');
  const peRow = row('PE');
  const pbRow = row('PB');
  const revenueRow = row('Revenue Growth');
  const marginRow = row('Gross Margin');
  const roeRow = row('ROE');
  const dividendRow = row('Dividend Yield');
  const return1mRow = row('1M Return');
  const return3mRow = row('3M Return');
  const return1yRow = row('1Y Return');
  const ratingRow = row('Analyst Rating');
  const momentumRow = row('Momentum');

  for (const symbol of symbols) {
    const data = perSymbol[symbol] ?? {};
    const provenance = perSymbolProvenance[symbol] ?? {};
    const quote = isRecord(data['market.quote']) ? data['market.quote'] : undefined;
    const valuation = isRecord(data['company.valuation']) ? data['company.valuation'] : undefined;
    const financials = extractFinancials(data['company.financials']);
    const dividendYield = extractDividendYield(data['company.dividends']);
    const klines = extractKlines(data['market.kline']);
    const rating = extractRatingLabel(data['company.ratings']);

    const return1m = periodReturn(klines, RETURN_WINDOWS['1M']);
    const return3m = periodReturn(klines, RETURN_WINDOWS['3M']);
    const return1y = periodReturn(klines, RETURN_WINDOWS['1Y']);

    const quoteProv = provenance['market.quote'];
    const valuationProv = provenance['company.valuation'];
    const financialsProv = provenance['company.financials'];
    const dividendsProv = provenance['company.dividends'];
    const ratingsProv = provenance['company.ratings'];
    // The kline provenance names the source of the bar series; the latest
    // bar's own timestamp is the honest `as_of` for return cells.
    const klineProv = withMarketTime(provenance['market.kline'], klines);

    quoteRow.cells[symbol] = priceCell(toFiniteNumber(quote?.lastPrice), quoteProv);
    marketCapRow.cells[symbol] = marketCapCell(toFiniteNumber(valuation?.totalMarketValue), valuationProv);
    peRow.cells[symbol] = ratioCell(toFiniteNumber(valuation?.pe), valuationProv);
    pbRow.cells[symbol] = ratioCell(toFiniteNumber(valuation?.pb), valuationProv);
    revenueRow.cells[symbol] = percentCell(financials.revenueGrowth, financialsProv);
    marginRow.cells[symbol] = percentCell(financials.grossMargin, financialsProv);
    roeRow.cells[symbol] = percentCell(financials.roe, financialsProv);
    dividendRow.cells[symbol] = percentCell(dividendYield, dividendsProv);
    return1mRow.cells[symbol] = percentCell(return1m, klineProv);
    return3mRow.cells[symbol] = percentCell(return3m, klineProv);
    return1yRow.cells[symbol] = percentCell(return1y, klineProv);
    ratingRow.cells[symbol] = labelCell(rating, ratingsProv);
    momentumRow.cells[symbol] = momentumCell(return1m, return3m, klineProv);
  }

  rows.push(
    quoteRow,
    marketCapRow,
    peRow,
    pbRow,
    revenueRow,
    marginRow,
    roeRow,
    dividendRow,
    return1mRow,
    return3mRow,
    return1yRow,
    ratingRow,
    momentumRow
  );
  return rows;
}

function row(metric: string): ComparisonRow {
  return { metric, cells: {} };
}

function extractFinancials(data: unknown): FinancialReportData {
  if (!isRecord(data)) return {};
  return {
    revenueGrowth: toFiniteNumber(data.revenueGrowth),
    grossMargin: toFiniteNumber(data.grossMargin),
    roe: toFiniteNumber(data.roe),
  };
}

function extractDividendYield(data: unknown): number | undefined {
  if (Array.isArray(data)) {
    for (const item of data) {
      const value = toFiniteNumber(isRecord(item) ? item.dividendYield : undefined);
      if (value !== undefined) return value;
    }
    return undefined;
  }
  return toFiniteNumber(isRecord(data) ? data.dividendYield : undefined);
}

function extractKlines(data: unknown): Array<{ timestamp: number; close: number }> {
  if (!Array.isArray(data)) return [];
  const bars: Array<{ timestamp: number; close: number }> = [];
  for (const item of data) {
    if (!isRecord(item)) continue;
    const timestamp = toFiniteNumber(item.timestamp);
    const close = toFiniteNumber(item.close);
    if (timestamp !== undefined && close !== undefined) bars.push({ timestamp, close });
  }
  return bars;
}

function extractRatingLabel(data: unknown): string | undefined {
  if (Array.isArray(data)) {
    for (const item of data) {
      if (!isRecord(item)) continue;
      const label = RATING_LABELS[String(item.rating ?? item.recommend ?? '').toLowerCase()];
      if (label) return label;
    }
    return undefined;
  }
  if (isRecord(data)) {
    return RATING_LABELS[String(data.consensus ?? data.recommend ?? data.rating ?? '').toLowerCase()];
  }
  return undefined;
}

/**
 * Percent price change from `days` trading sessions before the latest close to
 * the latest close. Returns `undefined` when there are not enough bars for the
 * window (a "1Y return" over 10 days of data would be dishonest).
 */
function periodReturn(klines: Array<{ timestamp: number; close: number }>, days: number): number | undefined {
  if (klines.length <= days) return undefined;
  const sorted = [...klines].sort((a, b) => a.timestamp - b.timestamp);
  const latest = sorted[sorted.length - 1];
  const base = sorted[sorted.length - 1 - days];
  if (!latest || !base || base.close === 0) return undefined;
  return ((latest.close - base.close) / base.close) * 100;
}

/**
 * Momentum classification (1M vs 3M return):
 *   - either return missing              → missing cell ('—')
 *   - sign(1M) != sign(3M)               → 'Mixed'
 *   - same sign and |1M| >= 5%           → 'Strong'
 *   - same sign and |1M| < 5%            → 'Weak'
 */
function momentum(oneMonth: number | undefined, threeMonth: number | undefined): string | undefined {
  if (oneMonth === undefined || threeMonth === undefined) return undefined;
  if ((oneMonth >= 0) !== (threeMonth >= 0)) return 'Mixed';
  return Math.abs(oneMonth) >= 5 ? 'Strong' : 'Weak';
}

/**
 * Attach the latest bar's own timestamp as `marketTime` when the kline
 * capability provenance does not carry one. Missing bars → provenance
 * unchanged; never stamped with the current time.
 */
function withMarketTime(
  provenance: CapabilityProvenance | undefined,
  klines: Array<{ timestamp: number; close: number }>
): CapabilityProvenance | undefined {
  if (!provenance || klines.length === 0) return provenance;
  if (provenance.marketTime !== undefined) return provenance;
  const latest = [...klines].sort((a, b) => a.timestamp - b.timestamp)[klines.length - 1];
  return latest ? { ...provenance, marketTime: latest.timestamp * 1000 } : provenance;
}

function priceCell(value: number | undefined, provenance?: CapabilityProvenance): ComparisonCell {
  if (value === undefined) return { missing: true, display: DASH };
  return { value, missing: false, display: `$${value.toFixed(2)}`, ...(provenance ? { provenance } : {}) };
}

function ratioCell(value: number | undefined, provenance?: CapabilityProvenance): ComparisonCell {
  if (value === undefined) return { missing: true, display: DASH };
  return { value, missing: false, display: value.toFixed(2), ...(provenance ? { provenance } : {}) };
}

function percentCell(value: number | undefined, provenance?: CapabilityProvenance): ComparisonCell {
  if (value === undefined) return { missing: true, display: DASH };
  return { value, missing: false, display: `${value.toFixed(1)}%`, ...(provenance ? { provenance } : {}) };
}

function marketCapCell(value: number | undefined, provenance?: CapabilityProvenance): ComparisonCell {
  if (value === undefined) return { missing: true, display: DASH };
  return { value, missing: false, display: formatMarketCap(value), ...(provenance ? { provenance } : {}) };
}

function labelCell(value: string | undefined, provenance?: CapabilityProvenance): ComparisonCell {
  if (value === undefined) return { missing: true, display: DASH };
  return { value, missing: false, display: value, ...(provenance ? { provenance } : {}) };
}

function momentumCell(
  oneMonth: number | undefined,
  threeMonth: number | undefined,
  provenance?: CapabilityProvenance
): ComparisonCell {
  const value = momentum(oneMonth, threeMonth);
  return labelCell(value, provenance);
}

function formatMarketCap(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  return `$${value.toFixed(2)}`;
}
