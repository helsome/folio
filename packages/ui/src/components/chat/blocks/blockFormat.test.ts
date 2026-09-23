import { describe, expect, it } from 'bun:test';
import { i18nSetCurrentLocale } from '@finagent/i18n';
import { formatBlockChange, formatBlockValue } from './blockFormat';

i18nSetCurrentLocale('en-US');

// `MetricGridBlockView` renders every delta through `formatBlockChange`, so a
// duplicated sign is directly visible in the Copilot metric cards.

describe('formatBlockChange', () => {
  it('signs percent deltas exactly once', () => {
    expect(formatBlockChange(1.5, 'percent')).toBe('+1.5%');
    expect(formatBlockChange(-1.5, 'percent')).toBe('−1.5%');
    expect(formatBlockChange(0, 'percent')).toBe('0%');
  });

  it('signs price deltas exactly once', () => {
    expect(formatBlockChange(1.5, 'price', 'USD')).toBe('+$1.50');
    expect(formatBlockChange(-2.25, 'price', 'USD')).toBe('−$2.25');
    expect(formatBlockChange(0, 'price', 'USD')).toBe('$0.00');
  });

  it('never emits two adjacent signs for any unit', () => {
    for (const unit of ['price', 'percent', 'ratio', 'count'] as const) {
      for (const value of [-12.5, -0.4, 0, 0.4, 12.5]) {
        expect(formatBlockChange(value, unit, 'USD')).not.toContain('++');
        expect(formatBlockChange(value, unit, 'USD')).not.toContain('−+');
      }
    }
  });

  it('leaves unsigned value formatting untouched', () => {
    expect(formatBlockValue(1.5, 'percent')).toBe('+1.5%');
    expect(formatBlockValue(0.235, 'ratio')).toBe('23.5%');
    expect(formatBlockValue(1234.5, 'count')).toBe('1,234.5');
  });
});
