import { describe, expect, it } from 'bun:test';
import { i18nCurrentLocale, i18nSetCurrentLocale } from '@finagent/i18n';
import { currencyForSymbol, formatMoney, formatQuantity } from './money';

describe('formatQuantity', () => {
  for (const locale of ['en-US', 'zh-CN'] as const) {
    it('preserves fractional shares and integer grouping in ' + locale, () => {
      const previous = i18nCurrentLocale();
      i18nSetCurrentLocale(locale);
      try {
        expect(formatQuantity(0.25)).toBe('0.25');
        expect(formatQuantity(1.5)).toBe('1.5');
        expect(formatQuantity(1e-8)).toBe('0.00000001');
        expect(formatQuantity(1e-20)).toBe('0.00000000000000000001');
        expect(Number(formatQuantity(1.5e-20))).toBe(1.5e-20);
        expect(Number(formatQuantity(1.2345678901234567e-20))).toBe(1.2345678901234567e-20);
        expect(formatQuantity(1e-21)).toBe('1E-21');
        expect(formatQuantity(-0.25)).toBe('-0.25');
        expect(formatQuantity(0)).toBe('0');
        expect(formatQuantity(1_234)).toBe('1,234');
      } finally {
        i18nSetCurrentLocale(previous);
      }
    });
  }

  it('keeps unavailable and non-finite quantities unavailable', () => {
    for (const value of [undefined, NaN, Infinity, -Infinity]) {
      expect(formatQuantity(value)).toBe('—');
    }
  });
});

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
