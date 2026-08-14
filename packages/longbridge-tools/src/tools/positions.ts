import { executeLongBridge } from '../executor.ts';
import { parsePositionsResponse } from '../parser.ts';
import type { Holding } from '@finagent/core';

/** Current equity positions across all sub-accounts (raw `positions` command). */
export async function getAccountPositions(): Promise<Holding[]> {
  const output = await executeLongBridge(['positions', '--format', 'json']);
  return parsePositionsResponse(output);
}
