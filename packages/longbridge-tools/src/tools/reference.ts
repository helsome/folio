import { executeLongBridge } from '../executor.ts';
import { validateSymbolOrThrow } from '../validator.ts';
import { parseCalcIndexResponse, parseMarketStatusResponse, parseNewsResponse, parseStaticInfoResponse } from '../parser.ts';
import type { CalcIndex, MarketStatus, NewsItem, StaticInfo } from '@finagent/core';

export interface GetStaticInfoOptions {
  symbol: string;
}

/** Static reference info (name, exchange, shares, EPS, dividend…). */
export async function getStaticInfo(symbol: string): Promise<StaticInfo> {
  validateSymbolOrThrow(symbol);
  const output = await executeLongBridge(['static', symbol, '--format', 'json']);
  return parseStaticInfoResponse(output);
}

export interface GetCalcIndexOptions {
  symbol: string;
  fields?: string[];
}

/** Calculated financial indexes (PE, PB, DPS rate, turnover rate…). */
export async function getCalcIndex(symbol: string, fields?: string[]): Promise<CalcIndex> {
  validateSymbolOrThrow(symbol);
  const args = ['calc-index', symbol, '--format', 'json'];
  if (fields && fields.length > 0) {
    args.push('--fields', fields.join(','));
  }
  const output = await executeLongBridge(args);
  return parseCalcIndexResponse(output);
}

/** Market open/close status for each exchange. */
export async function getMarketStatus(): Promise<MarketStatus[]> {
  const output = await executeLongBridge(['market-status', '--format', 'json']);
  return parseMarketStatusResponse(output);
}

export interface GetNewsOptions {
  symbol: string;
  count?: number;
}

/** Latest news articles for a symbol. */
export async function getNews(symbol: string, count = 20): Promise<NewsItem[]> {
  validateSymbolOrThrow(symbol);
  const args = ['news', symbol, '--count', String(count), '--format', 'json'];
  const output = await executeLongBridge(args);
  return parseNewsResponse(output);
}
