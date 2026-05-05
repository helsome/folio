import { executeLongBridge } from '../executor';
import { validateSymbolOrThrow } from '../validator';
import { parseQuoteResponse } from '../parser';
import type { Quote } from '@finagent/core';

export interface GetQuoteOptions {
  symbol: string;
}

export async function getQuote(symbol: string): Promise<Quote> {
  validateSymbolOrThrow(symbol);
  const output = await executeLongBridge(['quote', symbol, '--format', 'json']);
  return parseQuoteResponse(output);
}

export async function getQuotes(symbols: string[]): Promise<Quote[]> {
  if (symbols.length === 0) {
    return [];
  }
  symbols.forEach(validateSymbolOrThrow);
  const output = await executeLongBridge([
    'quote',
    ...symbols,
    '--format', 'json',
  ]);
  return JSON.parse(output).map(parseQuoteResponse);
}