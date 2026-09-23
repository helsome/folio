import { describe, expect, it } from 'bun:test';
import { LongBridgeError } from './errors.ts';
import { validateSymbol, validateSymbolOrThrow } from './validator.ts';

// Shanghai/Shenzhen listings carry a 6-digit code (`600519.SH`, `000001.SZ`),
// which is exactly what the `INVALID_SYMBOL` message documents as valid.

describe('validateSymbol', () => {
  it('accepts 6-digit A-share codes', () => {
    for (const symbol of ['600519.SH', '688111.SH', '000001.SZ', '300750.SZ', '002594.SZ']) {
      expect(validateSymbol(symbol)).toBe(true);
    }
  });

  it('still accepts the other documented markets', () => {
    for (const symbol of ['AAPL.US', '0700.HK', '1810.HK', 'D05.SG', 'BABA.HAS']) {
      expect(validateSymbol(symbol)).toBe(true);
    }
  });

  it('rejects bare tickers, unknown markets and over-long codes', () => {
    for (const symbol of ['600519', '600519.XX', '', 'TOOLONG.US', '6005191.SH', '600519.SH ']) {
      expect(validateSymbol(symbol)).toBe(false);
    }
  });
});

describe('validateSymbolOrThrow', () => {
  it('does not reject A-share or HK codes', () => {
    expect(() => validateSymbolOrThrow('600519.SH')).not.toThrow();
    expect(() => validateSymbolOrThrow('000001.SZ')).not.toThrow();
    expect(() => validateSymbolOrThrow('0700.HK')).not.toThrow();
  });

  it('throws INVALID_SYMBOL for malformed input', () => {
    expect(() => validateSymbolOrThrow('600519')).toThrow(LongBridgeError);
    expect(() => validateSymbolOrThrow('600519')).toThrow(/INVALID_SYMBOL/);
  });
});
