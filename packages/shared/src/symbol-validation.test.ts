import { describe, expect, it } from 'bun:test';
import { extractSymbol } from './agent/intent-router.ts';
import { symbolSchema } from './index.ts';

// A-share symbols carry a 6-digit code (`600519.SH`), HK symbols start with a
// digit (`0700.HK`), and both are documented as valid by the messages and
// manifests next to these guards.

describe('symbolSchema', () => {
  it('accepts 6-digit A-share codes and digit-leading HK codes', () => {
    for (const symbol of ['600519.SH', '000001.SZ', '300750.SZ', '0700.HK', '1810.HK']) {
      expect(symbolSchema.safeParse(symbol).success).toBe(true);
    }
  });

  it('still accepts US / SG / HAS listings and rejects malformed input', () => {
    for (const symbol of ['AAPL.US', 'D05.SG', 'BABA.HAS']) {
      expect(symbolSchema.safeParse(symbol).success).toBe(true);
    }
    for (const symbol of ['600519', '600519.XX', '6005191.SH', 'aapl.us', '']) {
      expect(symbolSchema.safeParse(symbol).success).toBe(false);
    }
  });
});

describe('extractSymbol', () => {
  it('finds 6-digit A-share codes in free text', () => {
    expect(extractSymbol('600519.SH 现在多少钱')).toBe('600519.SH');
    expect(extractSymbol('看看 000001.SZ 的K线')).toBe('000001.SZ');
  });

  it('still finds US and HK codes, and returns nothing when absent', () => {
    expect(extractSymbol('quote aapl.us please')).toBe('AAPL.US');
    expect(extractSymbol('1810.hk')).toBe('1810.HK');
    expect(extractSymbol('今天大盘怎么样')).toBeUndefined();
  });

  it('does not match over-long codes', () => {
    expect(extractSymbol('6005191.SH')).toBeUndefined();
  });
});
