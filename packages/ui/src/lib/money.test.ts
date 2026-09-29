import { describe, expect, it } from 'bun:test';
import { currencyForSymbol, formatMoney } from './money';

describe('currencyForSymbol (renderer mirror of @finagent/shared)', () => {
  it('routes each symbol suffix to its ISO currency', () => {
    expect(currencyForSymbol('AAPL.US')).toBe('USD');
    expect(currencyForSymbol('0700.HK')).toBe('HKD');
    expect(currencyForSymbol('600519.SH')).toBe('CNY');
    expect(currencyForSymbol('000001.SZ')).toBe('CNY');
    expect(currencyForSymbol('D05.SG')).toBe('SGD');
  });

  it('is case-insensitive and defaults unhandled suffixes to USD', () => {
    expect(currencyForSymbol('0700.hk')).toBe('HKD');
    expect(currencyForSymbol('BABA.HAS')).toBe('USD');
    expect(currencyForSymbol('')).toBe('USD');
    expect(currencyForSymbol(null)).toBe('USD');
    expect(currencyForSymbol(undefined)).toBe('USD');
  });

  it('formats a quote amount with that currency, never a bare $', () => {
    expect(formatMoney(350, currencyForSymbol('0700.HK'))).toBe('HK$350.00');
    expect(formatMoney(350, currencyForSymbol('600519.SH'))).toBe('CN¥350.00');
    expect(formatMoney(350, currencyForSymbol('D05.SG'))).toContain('SGD');
  });
});
