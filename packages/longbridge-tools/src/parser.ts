import { LongBridgeError } from './errors.ts';
import type { Quote, Portfolio, Kline, Position, IntradayData } from '@finagent/core';

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
