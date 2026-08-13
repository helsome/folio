import { LongBridgeError } from './errors.ts';
import type {
  CalcIndex,
  IntradayData,
  Kline,
  MarketStatus,
  NewsItem,
  Portfolio,
  Position,
  Quote,
  StaticInfo,
} from '@finagent/core';

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

interface RawPositionResponse {
  symbol: string;
  name: string;
  quantity: number;
  avg_cost: number;
  last_price: number;
  market_value: number;
  unrealized_pnl: number;
  unrealized_pnl_ratio: number;
}

interface RawPortfolioResponse {
  total_value: number;
  cash: number;
  positions: RawPositionResponse[];
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

export function parsePortfolioResponse(output: string): Portfolio {
  try {
    const data: RawPortfolioResponse = JSON.parse(output);
    return {
      totalValue: data.total_value,
      cash: data.cash,
      positions: data.positions.map((p): Position => ({
        symbol: p.symbol,
        name: p.name,
        quantity: p.quantity,
        avgCost: p.avg_cost,
        lastPrice: p.last_price,
        marketValue: p.market_value,
        unrealizedPnL: p.unrealized_pnl,
        unrealizedPnLPercent: p.unrealized_pnl_ratio * 100,
      })),
    };
  } catch (e) {
    throw new LongBridgeError(
      `Failed to parse portfolio response: ${output}`,
      'LONGBRIDGE_PARSE_FAILURE'
    );
  }
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
