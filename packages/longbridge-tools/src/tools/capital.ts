import { executeLongBridge } from '../executor.ts';
import { validateSymbolOrThrow } from '../validator.ts';
import { parseCapitalFlowResponse } from '../parser.ts';
import type { CapitalFlow } from '../types.ts';

/** Intraday capital-flow distribution snapshot for a symbol. */
export async function getCapitalFlow(symbol: string): Promise<CapitalFlow> {
  validateSymbolOrThrow(symbol);
  const output = await executeLongBridge(['capital', symbol, '--format', 'json']);
  return parseCapitalFlowResponse(output);
}
