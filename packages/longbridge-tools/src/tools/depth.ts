import { executeLongBridge } from '../executor.ts';
import { validateSymbolOrThrow } from '../validator.ts';
import { parseDepthResponse } from '../parser.ts';
import type { Depth } from '../types.ts';

/** Level 2 order book depth (bid/ask ladder) for a symbol. */
export async function getDepth(symbol: string): Promise<Depth> {
  validateSymbolOrThrow(symbol);
  const output = await executeLongBridge(['depth', symbol, '--format', 'json']);
  return parseDepthResponse(output);
}
