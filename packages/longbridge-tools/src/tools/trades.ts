import { executeLongBridge } from '../executor.ts';
import { validateSymbolOrThrow } from '../validator.ts';
import { parseTradesResponse } from '../parser.ts';
import type { TradeTick } from '../types.ts';

/** Recent tick-by-tick trades for a symbol. */
export async function getTrades(symbol: string, count = 20): Promise<TradeTick[]> {
  validateSymbolOrThrow(symbol);
  const output = await executeLongBridge([
    'trades',
    symbol,
    '--count',
    String(count),
    '--format',
    'json',
  ]);
  return parseTradesResponse(output);
}
