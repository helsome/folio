import { executeLongBridge } from '../executor.ts';
import { validateSymbolOrThrow } from '../validator.ts';
import { parseKlineResponse, parseIntradayResponse } from '../parser.ts';
import type { Kline, IntradayData } from '@finagent/core';

const VALID_PERIODS = ['1m', '5m', '15m', '1h', '1d', '1w'] as const;

export interface GetKlineOptions {
  symbol: string;
  period?: '1m' | '5m' | '15m' | '1h' | '1d' | '1w';
  start?: number;
  end?: number;
  limit?: number;
}

export async function getKline(options: GetKlineOptions): Promise<Kline[]> {
  const { symbol, period = '1d', start, end, limit = 100 } = options;
  validateSymbolOrThrow(symbol);

  const args = ['kline', symbol, '--period', period, '--format', 'json'];
  if (start) args.push('--start', String(start));
  if (end) args.push('--end', String(end));
  args.push('--limit', String(limit));

  const output = await executeLongBridge(args);
  return parseKlineResponse(output);
}

export interface GetIntradayOptions {
  symbol: string;
}

export async function getIntraday(symbol: string): Promise<IntradayData[]> {
  validateSymbolOrThrow(symbol);
  const output = await executeLongBridge(['intraday', symbol, '--format', 'json']);
  return parseIntradayResponse(output);
}
