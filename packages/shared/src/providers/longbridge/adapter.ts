import type {
  CapabilityId,
  FinancialDataProvider,
  Market,
  ProviderError,
  ProviderHealth,
  ProviderProvenance,
  ProviderResult,
} from '@finagent/core';
import { DEFAULT_MARKETS } from '@finagent/core';
import {
  getCalcIndex,
  getCalendarEvents,
  getCapitalFlow,
  getDepth,
  getDividends,
  getEpsForecasts,
  getFinancialReport,
  getInstitutionRating,
  getIntraday,
  getKline,
  getMarketStatus,
  getMarketTemperature,
  getNews,
  getQuote,
  getStaticInfo,
  getTrades,
  isLongBridgeError,
  LongBridgeError,
} from '@finagent/longbridge-tools';
import type {
  CalendarEventType,
  FinancialReportKind,
  GetCalendarEventsOptions,
  GetKlineOptions,
} from '@finagent/longbridge-tools';
import { isRecord } from '../../guards.ts';
import { LongbridgeHealthProbe, type LongbridgeExec } from './health.ts';

/**
 * Longbridge market-data provider (spec §4). Dispatch maps a capability id to
 * the matching `@finagent/longbridge-tools` function and normalizes its result
 * into a `ProviderResult` with Longbridge provenance. All failures map to
 * user-safe `ProviderError`s — raw CLI output never reaches a message.
 */

export const LONGBRIDGE_PROVIDER_ID = 'longbridge';
export const LONGBRIDGE_PROVIDER_NAME = 'Longbridge';

/** The 16 market-data capability ids Longbridge serves (spec §7). */
export const MARKET_DATA_CAPABILITIES: readonly CapabilityId[] = [
  'market.quote',
  'market.kline',
  'market.intraday',
  'market.depth',
  'market.trades',
  'market.capitalFlow',
  'market.sentiment',
  'market.status',
  'company.profile',
  'company.valuation',
  'company.financials',
  'company.dividends',
  'company.earnings',
  'company.ratings',
  'research.news',
  'research.events',
];

const ABORTED: ProviderError = { code: 'ABORTED', message: 'Request aborted' };

class AbortedRequest extends Error {
  constructor() {
    super('Aborted');
    this.name = 'AbortedRequest';
  }
}

/** Map a longbridge-tools failure to a user-safe `ProviderError`. */
export function toProviderError(error: unknown): ProviderError {
  if (isLongBridgeError(error)) {
    switch (error.code) {
      case 'LONGBRIDGE_NOT_AUTHED':
        return {
          code: 'AUTH_EXPIRED',
          message: 'Longbridge session expired. Reconnect from the Connections page.',
        };
      case 'LONGBRIDGE_TIMEOUT':
        return { code: 'TIMEOUT', message: 'Longbridge request timed out.', retryable: true };
      case 'LONGBRIDGE_PARSE_FAILURE':
        return { code: 'PARSE_FAILURE', message: 'Longbridge returned data in an unexpected format.' };
      case 'LONGBRIDGE_RATE_LIMITED':
        return {
          code: 'RATE_LIMITED',
          message: 'Longbridge rate limit reached. Wait a moment and retry.',
          retryable: true,
        };
      case 'INVALID_SYMBOL':
        return { code: 'PROVIDER_ERROR', message: 'A valid symbol is required.' };
      case 'LONGBRIDGE_NOT_INSTALLED':
        return { code: 'PROVIDER_ERROR', message: 'Longbridge CLI is not installed.' };
      default:
        return { code: 'PROVIDER_ERROR', message: 'Longbridge request failed.' };
    }
  }
  return { code: 'PROVIDER_ERROR', message: 'Longbridge request failed.' };
}

function marketTimeMsFrom(data: unknown): number | undefined {
  const items = Array.isArray(data) ? data : [data];
  for (const item of items) {
    if (!isRecord(item)) continue;
    const ts = item.timestamp;
    const seconds = typeof ts === 'number' ? ts : typeof ts === 'string' ? Number(ts) : undefined;
    if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0) {
      return seconds * 1000;
    }
  }
  return undefined;
}

export function longbridgeProvenance(data?: unknown): ProviderProvenance {
  return {
    providerId: LONGBRIDGE_PROVIDER_ID,
    providerName: LONGBRIDGE_PROVIDER_NAME,
    fetchedAt: Date.now(),
    marketTime: data === undefined ? undefined : marketTimeMsFrom(data),
    stale: false,
  };
}

export function withAbort<T>(signal: AbortSignal | undefined, run: () => Promise<T>): Promise<T> {
  if (!signal) return run();
  if (signal.aborted) return Promise.reject(new AbortedRequest());
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  const onAbort = () => reject(new AbortedRequest());
  signal.addEventListener('abort', onAbort, { once: true });
  run().then(
    (value) => {
      signal.removeEventListener('abort', onAbort);
      resolve(value);
    },
    (error) => {
      signal.removeEventListener('abort', onAbort);
      reject(error);
    }
  );
  return promise;
}

/**
 * Run a longbridge-tools call and wrap it as a `ProviderResult`: success
 * carries Longbridge provenance, failure carries a user-safe `ProviderError`,
 * and `signal` aborts into `ABORTED`.
 */
export async function runProviderCall<T>(
  run: () => Promise<unknown>,
  signal?: AbortSignal
): Promise<ProviderResult<T>> {
  if (signal?.aborted) return { ok: false, error: ABORTED };
  try {
    const data = await withAbort(signal, run);
    return { ok: true, data: data as T, provenance: longbridgeProvenance(data) };
  } catch (error) {
    if (error instanceof AbortedRequest || signal?.aborted) {
      return { ok: false, error: ABORTED };
    }
    return { ok: false, error: toProviderError(error) };
  }
}

// ── Input readers (input is `unknown` from the router) ─────────────────────

function readField(input: unknown, key: string): unknown {
  return isRecord(input) ? input[key] : undefined;
}

function readString(input: unknown, key: string): string | undefined {
  const value = readField(input, key);
  return typeof value === 'string' ? value : undefined;
}

function readNumber(input: unknown, key: string): number | undefined {
  const value = readField(input, key);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function readStringArray(input: unknown, key: string): string[] | undefined {
  const value = readField(input, key);
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((entry): entry is string => typeof entry === 'string');
  return strings.length > 0 ? strings : undefined;
}

function requireSymbol(input: unknown): string {
  const symbol = readString(input, 'symbol');
  if (!symbol) throw new LongBridgeError('A symbol is required', 'INVALID_SYMBOL');
  return symbol;
}

const KLINE_PERIODS = ['1m', '5m', '15m', '1h', '1d', '1w'] as const;
type KlinePeriod = (typeof KLINE_PERIODS)[number];

const FINANCIAL_REPORT_KINDS: readonly FinancialReportKind[] = ['IS', 'BS', 'CF', 'ALL'];
const CALENDAR_EVENT_TYPES: readonly CalendarEventType[] = [
  'financial',
  'report',
  'dividend',
  'ipo',
  'macrodata',
  'closed',
];

function klineOptionsOf(input: unknown): GetKlineOptions {
  const period = readString(input, 'period');
  const limit = readNumber(input, 'limit') ?? readNumber(input, 'count');
  const options: GetKlineOptions = { symbol: requireSymbol(input) };
  if ((KLINE_PERIODS as readonly string[]).includes(period ?? '')) {
    options.period = period as KlinePeriod;
  }
  if (limit !== undefined) options.limit = limit;
  const start = readNumber(input, 'start');
  const end = readNumber(input, 'end');
  if (start !== undefined) options.start = start;
  if (end !== undefined) options.end = end;
  return options;
}

function calendarOptionsOf(input: unknown): GetCalendarEventsOptions {
  const eventType = readString(input, 'eventType');
  if (!eventType || !(CALENDAR_EVENT_TYPES as readonly string[]).includes(eventType)) {
    throw new LongBridgeError('A valid event type is required', 'INVALID_SYMBOL');
  }
  const options: GetCalendarEventsOptions = { eventType: eventType as CalendarEventType };
  const symbols = readStringArray(input, 'symbols');
  const start = readString(input, 'start');
  const end = readString(input, 'end');
  const count = readNumber(input, 'count');
  if (symbols) options.symbols = symbols;
  if (start) options.start = start;
  if (end) options.end = end;
  if (count !== undefined) options.count = count;
  return options;
}

function financialKindOf(input: unknown): FinancialReportKind {
  const kind = readString(input, 'kind');
  return (FINANCIAL_REPORT_KINDS as readonly string[]).includes(kind ?? '')
    ? (kind as FinancialReportKind)
    : 'ALL';
}

type Dispatch = (input: unknown) => Promise<unknown>;

const DISPATCH: Record<string, Dispatch> = {
  'market.quote': (input) => getQuote(requireSymbol(input)),
  'market.kline': (input) => getKline(klineOptionsOf(input)),
  'market.intraday': (input) => getIntraday(requireSymbol(input)),
  'market.depth': (input) => getDepth(requireSymbol(input)),
  'market.trades': (input) => getTrades(requireSymbol(input), readNumber(input, 'count') ?? 20),
  'market.capitalFlow': (input) => getCapitalFlow(requireSymbol(input)),
  'market.sentiment': (input) => getMarketTemperature(readString(input, 'market') ?? 'US'),
  'market.status': () => getMarketStatus(),
  'company.profile': (input) => getStaticInfo(requireSymbol(input)),
  'company.valuation': (input) => getCalcIndex(requireSymbol(input), readStringArray(input, 'fields')),
  'company.financials': (input) =>
    getFinancialReport(requireSymbol(input), financialKindOf(input), readString(input, 'report')),
  'company.dividends': (input) => getDividends(requireSymbol(input)),
  'company.earnings': (input) => getEpsForecasts(requireSymbol(input)),
  'company.ratings': (input) => getInstitutionRating(requireSymbol(input)),
  'research.news': (input) => getNews(requireSymbol(input), readNumber(input, 'count') ?? 20),
  'research.events': (input) => getCalendarEvents(calendarOptionsOf(input)),
};

export interface LongbridgeFinancialDataProviderOptions {
  exec?: LongbridgeExec;
  probe?: LongbridgeHealthProbe;
}

export class LongbridgeFinancialDataProvider implements FinancialDataProvider {
  readonly kind = 'financial-data' as const;
  readonly id = LONGBRIDGE_PROVIDER_ID;
  readonly name = LONGBRIDGE_PROVIDER_NAME;

  private readonly probe: LongbridgeHealthProbe;

  constructor(options: LongbridgeFinancialDataProviderOptions = {}) {
    this.probe = options.probe ?? new LongbridgeHealthProbe({ exec: options.exec });
  }

  status(): Promise<ProviderHealth> {
    return this.probe.status();
  }

  capabilities(): CapabilityId[] {
    return [...MARKET_DATA_CAPABILITIES];
  }

  markets(): Market[] {
    return [...DEFAULT_MARKETS];
  }

  async execute<T>(
    capabilityId: CapabilityId,
    input: unknown,
    signal?: AbortSignal
  ): Promise<ProviderResult<T>> {
    if (signal?.aborted) return { ok: false, error: ABORTED };
    const dispatch = DISPATCH[capabilityId];
    if (!dispatch) {
      return {
        ok: false,
        error: { code: 'UNSUPPORTED_CAPABILITY', message: `Longbridge does not support "${capabilityId}".` },
      };
    }
    return runProviderCall<T>(() => dispatch(input), signal);
  }
}
