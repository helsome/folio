import { executeLongBridge } from '../executor.ts';
import { parseAssetsResponse } from '../parser.ts';
import type { Assets } from '../types.ts';

/** Account asset overview (one entry per reporting currency). */
export async function getAssets(currency?: string): Promise<Assets[]> {
  const args = ['assets'];
  if (currency) args.push('--currency', currency);
  args.push('--format', 'json');
  const output = await executeLongBridge(args);
  return parseAssetsResponse(output);
}
