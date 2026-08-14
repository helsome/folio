import { executeLongBridge } from '../executor.ts';
import { validateSymbolOrThrow } from '../validator.ts';
import { parseDividendResponse } from '../parser.ts';
import type { DividendRecord } from '../types.ts';

/** Dividend history for a symbol. */
export async function getDividends(symbol: string): Promise<DividendRecord[]> {
  validateSymbolOrThrow(symbol);
  const output = await executeLongBridge(['dividend', symbol, '--format', 'json']);
  return parseDividendResponse(output);
}
