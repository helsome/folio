import { LongBridgeError } from './errors.ts';

// Symbol format: AAPL.US, 0700.HK, 600519.SH, 0388.HK, etc.
// 1–6 characters. A-share listings are 6 digits; a 5-character limit rejects them.
const SYMBOL_REGEX = /^[A-Z0-9]{1,6}\.(US|HK|SG|SH|SZ|HAS)$/;

export function validateSymbol(symbol: string): boolean {
  return SYMBOL_REGEX.test(symbol);
}

export function validateSymbolOrThrow(symbol: string): void {
  if (!validateSymbol(symbol)) {
    throw new LongBridgeError(
      `INVALID_SYMBOL: ${symbol}. Expected format: AAPL.US, 0700.HK, 600519.SH`,
      'INVALID_SYMBOL'
    );
  }
}
