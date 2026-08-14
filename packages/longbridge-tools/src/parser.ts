import { LongBridgeError } from './errors.ts';
import type {
  AccountAssets,
  CalcIndex,
  CashFlowRecord,
  Holding,
  IntradayData,
  Kline,
  MarketStatus,
  NewsItem,
  PortfolioSnapshot,
  Quote,
  StaticInfo,
} from '@finagent/core';
import {
  normalizeAssets,
  normalizeCashFlow,
  normalizePortfolioSnapshot,
  normalizePositions,
} from './normalizer.ts';
import type { RawPortfolioResponse } from './normalizer.ts';
import type {
  CalendarEvent,
  CapitalFlow,
  CapitalFlowSide,
  Depth,
  DepthLevel,
  DividendRecord,
  EpsForecast,
  FinancialReport,
  FinancialReportAccount,
  FinancialReportIndicator,
  FinancialReportValue,
  InstitutionRating,
  MarketTemperature,
  RatingDistribution,
  TradeTick,
} from '@finagent/core/market-data';

interface RawQuoteResponse {
  symbol: string;
  last?: number | string;
  last_price?: number | string;
  change?: number | string;
  change_ratio?: number | string;
  volume?: number | string;
  timestamp?: number | string;
  high?: number | string;
  low?: number | string;
  open?: number | string;
  prev_close?: number | string;
}

interface RawKlineResponse {
  symbol?: string;
  timestamp?: number | string;
  time?: number | string;
  open: number | string;
  high: number | string;
  low: number | string;
  close: number | string;
  volume: number | string;
}

export function parseQuoteResponse(output: string): Quote {
  try {
    const parsed = JSON.parse(output);
    const data: RawQuoteResponse = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!data || typeof data !== 'object') {
      throw new Error('Quote response is empty');
    }

    const lastPrice = toNumber(data.last_price ?? data.last, 'last price');
    const prevClose = toNumber(data.prev_close, 'previous close');
    const change = data.change === undefined
      ? lastPrice - prevClose
      : toNumber(data.change, 'change');
    const changeRatio = data.change_ratio === undefined
      ? prevClose === 0 ? 0 : change / prevClose
      : toNumber(data.change_ratio, 'change ratio');

    return {
      symbol: data.symbol,
      lastPrice,
      change,
      changePercent: changeRatio * 100,
      volume: toNumber(data.volume ?? 0, 'volume'),
      timestamp: toTimestamp(data.timestamp),
      high: toNumber(data.high ?? lastPrice, 'high'),
      low: toNumber(data.low ?? lastPrice, 'low'),
      open: toNumber(data.open ?? lastPrice, 'open'),
      prevClose,
    };
  } catch (e) {
    throw new LongBridgeError(`Failed to parse quote response: ${output}`, 'LONGBRIDGE_PARSE_FAILURE');
  }
}

function parsePortfolioError(output: string): LongBridgeError {
  const debug = output.length > 2000 ? `${output.slice(0, 2000)}…` : output;
  return new LongBridgeError(
    'Portfolio data could not be read in the expected format.',
    'LONGBRIDGE_PARSE_FAILURE',
    debug
  );
}

export function parsePortfolioResponse(output: string): PortfolioSnapshot {
  let data: unknown;
  try {
    data = JSON.parse(output);
  } catch {
    throw parsePortfolioError(output);
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw parsePortfolioError(output);
  }
  return normalizePortfolioSnapshot(data as RawPortfolioResponse);
}

export function parseKlineResponse(output: string, fallbackSymbol = ''): Kline[] {
  try {
    const data: RawKlineResponse[] = JSON.parse(output);
    return data.map((k) => ({
      symbol: k.symbol ?? fallbackSymbol,
      timestamp: toTimestamp(k.timestamp ?? k.time),
      open: toNumber(k.open, 'open'),
      high: toNumber(k.high, 'high'),
      low: toNumber(k.low, 'low'),
      close: toNumber(k.close, 'close'),
      volume: toNumber(k.volume, 'volume'),
    }));
  } catch (e) {
    throw new LongBridgeError(`Failed to parse kline response: ${output}`, 'LONGBRIDGE_PARSE_FAILURE');
  }
}

export function parseIntradayResponse(output: string): IntradayData[] {
  try {
    const data = JSON.parse(output);
    return data.map((d: { symbol: string; timestamp: number; price: number; volume: number }) => ({
      symbol: d.symbol,
      timestamp: d.timestamp,
      price: d.price,
      volume: d.volume,
    }));
  } catch (e) {
    throw new LongBridgeError(
      `Failed to parse intraday response: ${output}`,
      'LONGBRIDGE_PARSE_FAILURE'
    );
  }
}

interface RawStaticInfoResponse {
  symbol: string;
  name: string;
  exchange?: string;
  currency?: string;
  lot_size?: number | string;
  total_shares?: number | string;
  'circ._shares'?: number | string;
  circulating_shares?: number | string;
  eps?: number | string;
  eps_ttm?: number | string;
  bps?: number | string;
  dividend?: number | string;
}

export function parseStaticInfoResponse(output: string): StaticInfo {
  try {
    const parsed = JSON.parse(output);
    const data: RawStaticInfoResponse = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!data || typeof data !== 'object') {
      throw new Error('Static info response is empty');
    }
    return {
      symbol: data.symbol,
      name: data.name,
      exchange: data.exchange,
      currency: data.currency,
      lotSize: toOptionalNumber(data.lot_size),
      totalShares: toOptionalNumber(data.total_shares),
      circulatingShares: toOptionalNumber(data['circ._shares'] ?? data.circulating_shares),
      eps: toOptionalNumber(data.eps),
      epsTtm: toOptionalNumber(data.eps_ttm),
      bps: toOptionalNumber(data.bps),
      dividend: toOptionalNumber(data.dividend),
    };
  } catch (e) {
    throw new LongBridgeError(`Failed to parse static info response: ${output}`, 'LONGBRIDGE_PARSE_FAILURE');
  }
}

interface RawCalcIndexResponse {
  symbol: string;
  pe?: number | string;
  pb?: number | string;
  dps_rate?: number | string;
  total_market_value?: number | string;
  turnover_rate?: number | string;
  ytd_change_rate?: number | string;
  volume_ratio?: number | string;
  amplitude?: number | string;
}

export function parseCalcIndexResponse(output: string): CalcIndex {
  try {
    const parsed = JSON.parse(output);
    const data: RawCalcIndexResponse = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!data || typeof data !== 'object') {
      throw new Error('Calc index response is empty');
    }
    return {
      symbol: data.symbol,
      pe: toOptionalNumber(data.pe),
      pb: toOptionalNumber(data.pb),
      dpsRate: toOptionalNumber(data.dps_rate),
      totalMarketValue: toOptionalNumber(data.total_market_value),
      turnoverRate: toOptionalNumber(data.turnover_rate),
      ytdChangeRate: toOptionalNumber(data.ytd_change_rate),
      volumeRatio: toOptionalNumber(data.volume_ratio),
      amplitude: toOptionalNumber(data.amplitude),
    };
  } catch (e) {
    throw new LongBridgeError(`Failed to parse calc-index response: ${output}`, 'LONGBRIDGE_PARSE_FAILURE');
  }
}

interface RawMarketStatusResponse {
  market: string;
  status: string;
}

export function parseMarketStatusResponse(output: string): MarketStatus[] {
  try {
    const data: RawMarketStatusResponse[] = JSON.parse(output);
    if (!Array.isArray(data)) {
      throw new Error('Market status response is not an array');
    }
    return data.map((entry) => ({ market: entry.market, status: entry.status }));
  } catch (e) {
    throw new LongBridgeError(`Failed to parse market-status response: ${output}`, 'LONGBRIDGE_PARSE_FAILURE');
  }
}

interface RawNewsResponse {
  id: string;
  title: string;
  url?: string;
  published_at?: number | string;
}

export function parseNewsResponse(output: string): NewsItem[] {
  try {
    const data: RawNewsResponse[] = JSON.parse(output);
    if (!Array.isArray(data)) {
      throw new Error('News response is not an array');
    }
    return data.map((entry) => ({
      id: String(entry.id),
      title: entry.title,
      summary: '',
      url: entry.url ?? `https://longbridge.cn/news/${entry.id}`,
      timestamp: toTimestamp(entry.published_at),
      symbols: [],
    }));
  } catch (e) {
    throw new LongBridgeError(`Failed to parse news response: ${output}`, 'LONGBRIDGE_PARSE_FAILURE');
  }
}

function toOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numberValue)) return undefined;
  return numberValue;
}

function toNumber(value: unknown, field: string): number {
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numberValue)) {
    throw new Error(`Invalid ${field}`);
  }
  return numberValue;
}

function toTimestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return Math.floor(parsed / 1000);
    }
  }
  return Math.floor(Date.now() / 1000);
}

// ── Phase-2 parsers ────────────────────────────────────────────────────────

interface RawDepthLevel {
  position: number | string;
  price: number | string;
  volume: number | string;
  order_num?: number | string;
}

interface RawDepthResponse {
  symbol: string;
  bids?: RawDepthLevel[];
  asks?: RawDepthLevel[];
}

export function parseDepthResponse(output: string): Depth {
  try {
    const data: RawDepthResponse = JSON.parse(output);
    if (!data || typeof data !== 'object') {
      throw new Error('Depth response is empty');
    }
    const level = (l: RawDepthLevel): DepthLevel => ({
      position: toNumber(l.position, 'position'),
      price: toNumber(l.price, 'price'),
      volume: toNumber(l.volume, 'volume'),
      orderNum: toNumber(l.order_num ?? 0, 'order_num'),
    });
    return {
      symbol: data.symbol,
      bids: (data.bids ?? []).map(level),
      asks: (data.asks ?? []).map(level),
    };
  } catch (e) {
    throw new LongBridgeError(`Failed to parse depth response: ${output}`, 'LONGBRIDGE_PARSE_FAILURE');
  }
}

interface RawTradeTick {
  time: string;
  price: number | string;
  volume: number | string;
  direction?: string;
  type?: string;
}

export function parseTradesResponse(output: string): TradeTick[] {
  try {
    const data: RawTradeTick[] = JSON.parse(output);
    if (!Array.isArray(data)) {
      throw new Error('Trades response is not an array');
    }
    return data.map((t) => ({
      timestamp: toEpochSeconds(t.time) ?? 0,
      price: toNumber(t.price, 'price'),
      volume: toNumber(t.volume, 'volume'),
      direction: t.direction ?? '',
      type: t.type ?? '',
    }));
  } catch (e) {
    throw new LongBridgeError(`Failed to parse trades response: ${output}`, 'LONGBRIDGE_PARSE_FAILURE');
  }
}

interface RawCapitalFlowSide {
  large?: number | string;
  medium?: number | string;
  small?: number | string;
}

interface RawCapitalFlowResponse {
  symbol: string;
  timestamp?: number | string;
  capital_in?: RawCapitalFlowSide;
  capital_out?: RawCapitalFlowSide;
}

export function parseCapitalFlowResponse(output: string): CapitalFlow {
  try {
    const data: RawCapitalFlowResponse = JSON.parse(output);
    if (!data || typeof data !== 'object') {
      throw new Error('Capital flow response is empty');
    }
    const side = (s?: RawCapitalFlowSide): CapitalFlowSide => ({
      large: toNumber(s?.large ?? 0, 'large'),
      medium: toNumber(s?.medium ?? 0, 'medium'),
      small: toNumber(s?.small ?? 0, 'small'),
    });
    return {
      symbol: data.symbol,
      timestamp: toEpochSeconds(data.timestamp) ?? 0,
      capitalIn: side(data.capital_in),
      capitalOut: side(data.capital_out),
    };
  } catch (e) {
    throw new LongBridgeError(`Failed to parse capital flow response: ${output}`, 'LONGBRIDGE_PARSE_FAILURE');
  }
}

interface RawMarketTemperatureItem {
  field: string;
  value: string;
}

export function parseMarketTemperatureResponse(output: string): MarketTemperature {
  try {
    const items: RawMarketTemperatureItem[] = JSON.parse(output);
    if (!Array.isArray(items)) {
      throw new Error('Market temperature response is not an array');
    }
    const field = (name: string) => items.find((i) => i.field === name)?.value ?? '';
    return {
      market: field('Market') || 'US',
      temperature: toNumber(field('Temperature'), 'temperature'),
      description: field('Description'),
      valuation: toNumber(field('Valuation'), 'valuation'),
      sentiment: toNumber(field('Sentiment'), 'sentiment'),
    };
  } catch (e) {
    throw new LongBridgeError(`Failed to parse market-temp response: ${output}`, 'LONGBRIDGE_PARSE_FAILURE');
  }
}

interface RawFinancialReportValue {
  fp_end?: number | string;
  period?: string;
  ratio?: string;
  value?: number | string;
  year?: number;
  yoy?: string;
}

interface RawFinancialReportAccount {
  field?: string;
  industry_ranking?: string;
  name?: string;
  percent?: boolean;
  ranking_code?: string;
  tip?: string;
  values?: RawFinancialReportValue[];
}

interface RawFinancialReportIndicator {
  accounts?: RawFinancialReportAccount[];
  currency?: string;
  has_yoy?: boolean;
  periods?: string[];
  short_title?: string;
  title?: string;
}

interface RawFinancialReportResponse {
  symbol: string;
  report: string;
  list?: Record<string, { indicators?: RawFinancialReportIndicator[] }>;
}

export function parseFinancialReportResponse(output: string, fallbackSymbol = ''): FinancialReport {
  try {
    const data: RawFinancialReportResponse = JSON.parse(output);
    const statements: FinancialReport['statements'] = {};
    for (const [key, stmt] of Object.entries(data.list ?? {})) {
      if (!stmt || !Array.isArray(stmt.indicators)) continue;
      const indicators: FinancialReportIndicator[] = stmt.indicators.map((ind) => ({
        title: ind.title ?? '',
        hasYoy: ind.has_yoy,
        periods: ind.periods,
        accounts: (ind.accounts ?? []).map((acc): FinancialReportAccount => ({
          field: acc.field ?? '',
          name: acc.name ?? '',
          rankingCode: acc.ranking_code,
          industryRanking: acc.industry_ranking,
          percent: acc.percent,
          tip: acc.tip,
          values: (acc.values ?? []).map((v): FinancialReportValue => ({
            fpEnd: toEpochSeconds(v.fp_end) ?? 0,
            period: v.period ?? '',
            year: toNumber(v.year ?? 0, 'year'),
            value: toNumber(v.value ?? 0, 'value'),
            ratio: v.ratio,
            yoy: v.yoy,
          })),
        })),
      }));
      const upper = key.toUpperCase();
      if (upper === 'IS') statements.IS = { indicators };
      else if (upper === 'BS') statements.BS = { indicators };
      else if (upper === 'CF') statements.CF = { indicators };
    }
    return { symbol: data.symbol || fallbackSymbol, report: data.report, statements };
  } catch (e) {
    throw new LongBridgeError(`Failed to parse financial-report response: ${output}`, 'LONGBRIDGE_PARSE_FAILURE');
  }
}

interface RawRatingDistribution {
  buy?: number | string;
  hold?: number | string;
  sell?: number | string;
  strong_buy?: number | string;
  no_opinion?: number | string;
  over?: number | string;
  under?: number | string;
  total?: number | string;
}

interface RawInstitutionRatingResponse {
  analyst?: {
    evaluate?: RawRatingDistribution;
    industry_mean?: number;
    industry_median?: number;
    industry_name?: string;
    industry_rank?: number;
    industry_total?: number;
    target?: {
      highest_price?: number | string;
      lowest_price?: number | string;
      prev_close?: number | string;
      start_date?: number | string;
      end_date?: number | string;
    };
  };
  instratings?: {
    ccy_symbol?: string;
    change?: number | string;
    evaluate?: RawRatingDistribution;
    recommend?: string;
    target?: number | string;
    updated_at?: string;
  };
}

export function parseInstitutionRatingResponse(output: string, symbol = ''): InstitutionRating {
  try {
    const data: RawInstitutionRatingResponse = JSON.parse(output);
    const { analyst, instratings } = data;
    const dist = (d?: RawRatingDistribution): RatingDistribution => ({
      buy: toNumber(d?.buy ?? 0, 'buy'),
      hold: toNumber(d?.hold ?? 0, 'hold'),
      sell: toNumber(d?.sell ?? 0, 'sell'),
      strongBuy: toOptionalNumber(d?.strong_buy),
      noOpinion: toOptionalNumber(d?.no_opinion),
      over: toOptionalNumber(d?.over),
      under: toOptionalNumber(d?.under),
      total: toNumber(d?.total ?? 0, 'total'),
    });
    return {
      symbol,
      recommend: instratings?.recommend ?? '',
      target: toOptionalNumber(instratings?.target),
      updatedAt: toEpochSeconds(instratings?.updated_at),
      analyst: analyst
        ? {
            distribution: dist(analyst.evaluate),
            industryName: analyst.industry_name,
            industryRank: analyst.industry_rank,
            industryMean: analyst.industry_mean,
            industryMedian: analyst.industry_median,
            industryTotal: analyst.industry_total,
            highestTarget: toOptionalNumber(analyst.target?.highest_price),
            lowestTarget: toOptionalNumber(analyst.target?.lowest_price),
            prevClose: toOptionalNumber(analyst.target?.prev_close),
          }
        : undefined,
      institutional: instratings
        ? {
            distribution: dist(instratings.evaluate),
            currency: instratings.ccy_symbol,
            change: toOptionalNumber(instratings.change),
          }
        : undefined,
    };
  } catch (e) {
    throw new LongBridgeError(`Failed to parse institution-rating response: ${output}`, 'LONGBRIDGE_PARSE_FAILURE');
  }
}

interface RawDividendRecord {
  counter_id?: string;
  desc?: string;
  ex_date?: string;
  id?: string;
  payment_date?: string;
  record_date?: string;
}

interface RawDividendResponse {
  total?: number | string;
  list?: RawDividendRecord[];
}

export function parseDividendResponse(output: string): DividendRecord[] {
  try {
    const data: RawDividendResponse = JSON.parse(output);
    const list = Array.isArray(data) ? (data as unknown as RawDividendRecord[]) : data.list ?? [];
    if (!Array.isArray(list)) {
      throw new Error('Dividend response is not an array');
    }
    return list.map((d): DividendRecord => ({
      id: String(d.id ?? ''),
      description: d.desc ?? '',
      exDate: toEpochSeconds(d.ex_date) ?? 0,
      paymentDate: toEpochSeconds(d.payment_date),
      recordDate: toEpochSeconds(d.record_date),
      counterId: d.counter_id,
    }));
  } catch (e) {
    throw new LongBridgeError(`Failed to parse dividend response: ${output}`, 'LONGBRIDGE_PARSE_FAILURE');
  }
}

interface RawEpsForecastItem {
  forecast_end_date?: number | string;
  forecast_eps_highest?: number | string;
  forecast_eps_lowest?: number | string;
  forecast_eps_mean?: number | string;
  forecast_eps_median?: number | string;
  forecast_start_date?: number | string;
  institution_down?: number;
  institution_total?: number;
  institution_up?: number;
}

interface RawEpsForecastResponse {
  items?: RawEpsForecastItem[];
}

export function parseEpsForecastResponse(output: string): EpsForecast[] {
  try {
    const data: RawEpsForecastResponse = JSON.parse(output);
    const items = data.items ?? [];
    if (!Array.isArray(items)) {
      throw new Error('Forecast EPS response is not an array');
    }
    return items.map((f): EpsForecast => ({
      endDate: toEpochSeconds(f.forecast_end_date) ?? 0,
      startDate: toEpochSeconds(f.forecast_start_date) ?? 0,
      epsMean: toNumber(f.forecast_eps_mean ?? 0, 'forecast_eps_mean'),
      epsMedian: toOptionalNumber(f.forecast_eps_median),
      epsHighest: toOptionalNumber(f.forecast_eps_highest),
      epsLowest: toOptionalNumber(f.forecast_eps_lowest),
      institutionUp: f.institution_up,
      institutionDown: f.institution_down,
      institutionTotal: f.institution_total,
    }));
  } catch (e) {
    throw new LongBridgeError(`Failed to parse forecast-eps response: ${output}`, 'LONGBRIDGE_PARSE_FAILURE');
  }
}

interface RawCalendarEventData {
  key?: string;
  type?: string;
  value?: string;
  value_raw?: string;
}

interface RawCalendarEventInfo {
  activity_type?: string;
  content?: string;
  counter_id?: string;
  counter_name?: string;
  currency?: string;
  data_kv?: RawCalendarEventData[];
  datetime?: number | string;
  ext?: { local_date?: string };
  id?: string;
  market?: string;
  type?: string;
}

interface RawCalendarEventGroup {
  count?: number;
  date?: string;
  infos?: RawCalendarEventInfo[];
}

interface RawCalendarResponse {
  date?: string;
  list?: RawCalendarEventGroup[];
  next_date?: string;
  result?: unknown;
}

export function parseCalendarResponse(output: string): CalendarEvent[] {
  try {
    const data: RawCalendarResponse = JSON.parse(output);
    const events: CalendarEvent[] = [];
    for (const group of data.list ?? []) {
      for (const info of group.infos ?? []) {
        events.push({
          id: String(info.id ?? ''),
          date: toEpochSeconds(info.datetime) ?? 0,
          type: info.type ?? '',
          activityType: info.activity_type,
          symbol: counterIdToSymbol(info.counter_id, info.market),
          counterId: info.counter_id,
          name: info.counter_name,
          market: info.market,
          currency: info.currency,
          content: info.content,
          localDate: info.ext?.local_date,
          data: (info.data_kv ?? []).map((kv) => ({
            type: kv.type ?? '',
            value: kv.value ?? '',
            valueRaw: kv.value_raw,
          })),
        });
      }
    }
    return events;
  } catch (e) {
    throw new LongBridgeError(`Failed to parse finance-calendar response: ${output}`, 'LONGBRIDGE_PARSE_FAILURE');
  }
}

/** `ST/US/NVDA` → `NVDA.US` (best effort; empty when not derivable). */
function counterIdToSymbol(counterId?: string, market?: string): string {
  if (!counterId) return '';
  const parts = counterId.split('/');
  const code = parts[parts.length - 1] ?? '';
  if (!code) return '';
  const mkt = market ?? (parts.length >= 2 ? parts[1] : '');
  return mkt ? `${code}.${mkt}` : code;
}

export function parsePositionsResponse(output: string): Holding[] {
  let data: unknown;
  try {
    data = JSON.parse(output);
  } catch {
    throw parsePortfolioError(output);
  }
  if (!Array.isArray(data)) {
    throw parsePortfolioError(output);
  }
  return normalizePositions(data);
}

export function parseAssetsResponse(output: string): AccountAssets[] {
  let data: unknown;
  try {
    data = JSON.parse(output);
  } catch {
    throw parsePortfolioError(output);
  }
  if (!Array.isArray(data)) {
    throw parsePortfolioError(output);
  }
  return normalizeAssets(data);
}

export function parseCashFlowResponse(output: string): CashFlowRecord[] {
  let data: unknown;
  try {
    data = JSON.parse(output);
  } catch {
    throw parsePortfolioError(output);
  }
  if (!Array.isArray(data)) {
    throw parsePortfolioError(output);
  }
  return normalizeCashFlow(data);
}

/**
 * Normalize a timestamp-like value to epoch seconds. Handles numbers (assumed
 * epoch seconds), numeric strings (`"1772064000"`), `YYYY.MM.DD`, `YYYY 年 M 月
 * D 日`, and ISO date strings. Returns `undefined` when unparseable.
 */
function toEpochSeconds(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '' || trimmed === '0') return undefined;
    if (/^\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      return Number.isFinite(n) ? n : undefined;
    }
    const dotMatch = /(\d{4})\.(\d{1,2})\.(\d{1,2})/.exec(trimmed);
    if (dotMatch) {
      return Math.floor(
        Date.UTC(Number(dotMatch[1]), Number(dotMatch[2]) - 1, Number(dotMatch[3])) / 1000
      );
    }
    const zhMatch = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/.exec(trimmed);
    if (zhMatch) {
      return Math.floor(
        Date.UTC(Number(zhMatch[1]), Number(zhMatch[2]) - 1, Number(zhMatch[3])) / 1000
      );
    }
    const parsed = Date.parse(trimmed);
    if (Number.isFinite(parsed)) {
      return Math.floor(parsed / 1000);
    }
  }
  return undefined;
}
