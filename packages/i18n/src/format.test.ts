import { describe, it, expect } from 'bun:test';
import {
  formatCompactNumber,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatPercentRatio,
  formatRelativeTime,
  formatShortDate,
  formatSignedCurrency,
  i18nCurrentLocale,
  i18nSetCurrentLocale,
} from './format.ts';

// Deterministic context for relative-time assertions.
const NOW = new Date('2026-08-18T12:00:00Z').getTime();

describe('formatters (spec §52–59)', () => {
  it('currency: ICC outputs per locale and never hardcodes $', () => {
    expect(formatCurrency(1234.56, 'USD', 'en-US')).toContain('1,234.56');
    expect(formatCurrency(1234.56, 'USD', 'zh-CN')).toContain('US$');
    expect(formatCurrency(1234.56, 'HKD', 'zh-CN')).toContain('HK$');
    expect(formatCurrency(1234.56, 'CNY', 'zh-CN')).toContain('¥');
    expect(formatCurrency(undefined, 'USD', 'en-US')).toBe('—');
    // Unknown currency falls back to number + ISO code.
    expect(formatCurrency(12.5, 'XYZ', 'en-US')).toContain('XYZ');
  });

  it('signed currency keeps + sign', () => {
    expect(formatSignedCurrency(12.34, 'USD', 'en-US').startsWith('+')).toBe(true);
    expect(formatSignedCurrency(-3, 'USD', 'en-US').startsWith('-')).toBe(true);
  });

  it('percent: value IS ×100 (repo convention), ratio version takes 0..1 (no 100x bug, §56)', () => {
    expect(formatPercent(23.5, 'en-US')).toBe('+23.5%');
    expect(formatPercent(-5, 'en-US')).toBe('-5%');
    expect(formatPercentRatio(0.235, 'en-US')).toBe('23.5%');
    // The 100x bug: feeding a ×100 value into the ratio helper doubles it.
    expect(formatPercentRatio(0.5, 'en-US')).toBe('50%');
  });

  it('compact numbers are locale-aware (en 1.2B / zh 亿)', () => {
    const en = formatCompactNumber(1_200_000_000, 'en-US');
    expect(en).toMatch(/1\.2\s*B/);
    const zh = formatCompactNumber(1_200_000_000, 'zh-CN');
    expect(zh).toContain('亿');
  });

  it('grouped numbers localize separators', () => {
    expect(formatNumber(1234567.5, 'en-US')).toContain('1,234,567.5');
  });

  it('date formats per locale', () => {
    expect(formatDate(new Date('2026-08-18T00:00:00Z').getTime(), 'en-US')).toContain('2026');
    expect(formatDate(new Date('2026-08-18T00:00:00Z').getTime(), 'zh-CN')).toContain('2026');
    expect(formatDate(new Date('2026-08-18T00:00:00Z').getTime(), 'zh-CN')).toContain('月');
    expect(formatDateTime(new Date('2026-08-18T08:30:00Z').getTime(), 'en-US')).toContain('2026');
  });

  it('relative time: seconds/minutes/hours/day per locale', () => {
    expect(formatRelativeTime(NOW - 8000, NOW, 'en-US')).toMatch(/8 seconds? ago/);
    expect(formatRelativeTime(NOW - 8000, NOW, 'zh-CN')).toMatch(/8(\u79D2|秒)/);
    expect(formatRelativeTime(NOW - 5 * 60_000, NOW, 'zh-CN')).toMatch(/分钟/);
    expect(formatRelativeTime(NOW - 2 * 3_600_000, NOW, 'en-US')).toMatch(/2 hours? ago/);
  });

  it('undefined → em dash; current-locale default follows i18n switch', () => {
    i18nSetCurrentLocale('zh-CN');
    expect(formatCurrency(100, 'USD')).toContain('US$');
    i18nSetCurrentLocale('en-US');
    expect(formatCurrency(100, 'USD')).not.toContain('US$');
    i18nSetCurrentLocale('zh-CN');
  });

  it('short date has no year and follows the app locale, not the host locale', () => {
    const ts = Date.UTC(2024, 10, 21, 9, 20, 0);
    const host = new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const saved = i18nCurrentLocale();
    try {
      expect(formatShortDate(ts, 'en-US')).not.toContain('2024');
      expect(formatShortDate(ts, 'zh-CN')).toContain('月');
      expect(formatShortDate(ts, 'zh-CN')).not.toContain('2024');
      expect(formatShortDate(undefined, 'en-US')).toBe('—');

      let sawMismatch = false;
      for (const locale of ['zh-CN', 'en-US'] as const) {
        i18nSetCurrentLocale(locale);
        const expected = formatShortDate(ts);
        if (expected === host) continue;
        sawMismatch = true;
        expect(formatShortDate(ts)).toBe(expected);
        expect(formatShortDate(ts)).not.toBe(host);
        break;
      }
      if (!sawMismatch) {
        throw new Error(
          `host locale renders ${JSON.stringify(host)} identically to both supported locales — the assertion would be vacuous`,
        );
      }
    } finally {
      i18nSetCurrentLocale(saved);
    }
  });
});
