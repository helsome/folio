import { executeLongBridge } from '../executor.ts';
import { parsePositionsResponse } from '../parser.ts';
import type { Position } from '../types.ts';

/** Current equity positions across all sub-accounts (raw `positions` command). */
export async function getAccountPositions(): Promise<Position[]> {
  const output = await executeLongBridge(['positions', '--format', 'json']);
  return parsePositionsResponse(output);
}
