import { executeLongBridge } from '../executor.ts';
import { LongBridgeError } from '../errors.ts';
import { parseMarketTemperatureResponse } from '../parser.ts';
import type { MarketTemperature } from '../types.ts';

const VALID_MARKETS = ['HK', 'US', 'CN', 'SH', 'SZ', 'SG'] as const;

function normalizeMarket(market: string): string {
  const upper = market.trim().toUpperCase();
  if (upper === 'SH' || upper === 'SZ') return 'CN';
  if (!VALID_MARKETS.includes(upper as (typeof VALID_MARKETS)[number])) {
    throw new LongBridgeError(
      `INVALID_MARKET: ${market}. Expected one of: HK, US, CN (SH/SZ), SG`,
      'INVALID_SYMBOL'
    );
  }
  return upper;
}

/**
 * Market sentiment temperature index for a market. The CLI takes a market
 * (`US`/`HK`/`CN`/`SG`), not a symbol.
 */
export async function getMarketTemperature(market = 'US'): Promise<MarketTemperature> {
  const normalized = normalizeMarket(market);
  const output = await executeLongBridge(['market-temp', normalized, '--format', 'json']);
  return parseMarketTemperatureResponse(output);
}
