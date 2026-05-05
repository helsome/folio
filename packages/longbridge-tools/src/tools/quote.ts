import { executeLongBridge } from '../executor.ts';
import { validateSymbolOrThrow } from '../validator.ts';
import { parseQuoteResponse } from '../parser.ts';
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
  const parsed = JSON.parse(output);
  const items = Array.isArray(parsed) ? parsed : [parsed];
  return items.map((item) => parseQuoteResponse(JSON.stringify(item)));
}
