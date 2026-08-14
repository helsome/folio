import { executeLongBridge } from '../executor.ts';
import { parseAssetsResponse } from '../parser.ts';
import type { AccountAssets } from '@finagent/core';

/** Account asset overview (one entry per reporting currency). */
export async function getAssets(currency?: string): Promise<AccountAssets[]> {
  const args = ['assets'];
  if (currency) args.push('--currency', currency);
  args.push('--format', 'json');
  const output = await executeLongBridge(args);
  return parseAssetsResponse(output);
}
