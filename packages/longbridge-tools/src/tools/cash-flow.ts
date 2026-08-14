import { executeLongBridge } from '../executor.ts';
import { parseCashFlowResponse } from '../parser.ts';
import type { CashFlowRecord } from '../types.ts';

export interface GetCashFlowOptions {
  /** Start date (YYYY-MM-DD), defaults to 30 days ago. */
  start?: string;
  /** End date (YYYY-MM-DD), defaults to today. */
  end?: string;
}

/** Cash-flow records (deposits, withdrawals, dividends, settlements). */
export async function getCashFlow(options: GetCashFlowOptions = {}): Promise<CashFlowRecord[]> {
  const args = ['cash-flow'];
  if (options.start) args.push('--start', options.start);
  if (options.end) args.push('--end', options.end);
  args.push('--format', 'json');
  const output = await executeLongBridge(args);
  return parseCashFlowResponse(output);
}
