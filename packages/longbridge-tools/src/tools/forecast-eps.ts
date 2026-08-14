import { executeLongBridge } from '../executor.ts';
import { validateSymbolOrThrow } from '../validator.ts';
import { parseEpsForecastResponse } from '../parser.ts';
import type { EpsForecast } from '../types.ts';

/** EPS forecasts and analyst consensus estimates for a symbol. */
export async function getEpsForecasts(symbol: string): Promise<EpsForecast[]> {
  validateSymbolOrThrow(symbol);
  const output = await executeLongBridge(['forecast-eps', symbol, '--format', 'json']);
  return parseEpsForecastResponse(output);
}
