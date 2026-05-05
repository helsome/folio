import { LongBridgeError } from './errors';
import type { Quote, Portfolio, Kline, Position, IntradayData } from '@finagent/core';

interface RawQuoteResponse {
  symbol: string;
  last_price: number;
  change: number;
  change_ratio: number;
  volume: number;
  timestamp: number;
  high: number;
  low: number;
  open: number;
  prev_close: number;
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
  symbol: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function parseQuoteResponse(output: string): Quote {
  try {
    const data: RawQuoteResponse = JSON.parse(output);
    return {
      symbol: data.symbol,
      lastPrice: data.last_price,
      change: data.change,
      changePercent: data.change_ratio * 100,
      volume: data.volume,
      timestamp: data.timestamp,
      high: data.high,
      low: data.low,
      open: data.open,
      prevClose: data.prev_close,
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

export function parseKlineResponse(output: string): Kline[] {
  try {
    const data: RawKlineResponse[] = JSON.parse(output);
    return data.map((k) => ({
      symbol: k.symbol,
      timestamp: k.timestamp,
      open: k.open,
      high: k.high,
      low: k.low,
      close: k.close,
      volume: k.volume,
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
