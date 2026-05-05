// Symbol format: AAPL.US, 0700.HK, 600519.SH, 0388.HK, etc.
// Allow 1-5 chars of A-Z and 0-9
const SYMBOL_REGEX = /^[A-Z0-9]{1,5}\.(US|HK|SG|SH|SZ|HAS)$/;

export function validateSymbol(symbol: string): boolean {
  return SYMBOL_REGEX.test(symbol);
}

export function validateSymbolOrThrow(symbol: string): void {
  if (!validateSymbol(symbol)) {
    throw new Error(`INVALID_SYMBOL: ${symbol}. Expected format: AAPL.US, 0700.HK, 600519.SH`);
  }
}