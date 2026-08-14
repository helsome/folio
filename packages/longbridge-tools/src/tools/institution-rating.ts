import { executeLongBridge } from '../executor.ts';
import { validateSymbolOrThrow } from '../validator.ts';
import { parseInstitutionRatingResponse } from '../parser.ts';
import type { InstitutionRating } from '../types.ts';

/** Institution rating overview and target-price consensus for a symbol. */
export async function getInstitutionRating(symbol: string): Promise<InstitutionRating> {
  validateSymbolOrThrow(symbol);
  const output = await executeLongBridge(['institution-rating', symbol, '--format', 'json']);
  return parseInstitutionRatingResponse(output, symbol);
}
