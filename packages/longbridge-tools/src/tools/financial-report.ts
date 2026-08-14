import { executeLongBridge } from '../executor.ts';
import { validateSymbolOrThrow } from '../validator.ts';
import { parseFinancialReportResponse } from '../parser.ts';
import type { FinancialReport } from '../types.ts';

export type FinancialReportKind = 'IS' | 'BS' | 'CF' | 'ALL';

/** Financial statements (income, balance sheet, cash flow) for a symbol. */
export async function getFinancialReport(
  symbol: string,
  kind: FinancialReportKind = 'ALL',
  report?: string
): Promise<FinancialReport> {
  validateSymbolOrThrow(symbol);
  const args = ['financial-report', symbol, '--kind', kind];
  if (report) args.push('--report', report);
  args.push('--format', 'json');
  const output = await executeLongBridge(args);
  return parseFinancialReportResponse(output, symbol);
}
