import { describe, expect, it } from 'bun:test';
import { capabilityLabelKey, hasCapabilityLabel } from './capabilityLabels';

describe('capabilityLabels (V9 semantic activity)', () => {
  it('maps every targeted capability id to a user-facing i18n key', () => {
    const ids = [
      'market.quote',
      'market.kline',
      'market.intraday',
      'market.trades',
      'market.depth',
      'market.status',
      'market.capitalFlow',
      'company.profile',
      'company.valuation',
      'company.financials',
      'company.earnings',
      'company.dividends',
      'company.ratings',
      'research.news',
      'research.events',
      'portfolio.summary',
    ];
    for (const id of ids) {
      const key = capabilityLabelKey(id);
      expect(key, `${id} should have a label key`).not.toBeNull();
      expect(key?.startsWith('research.capabilities.')).toBe(true);
      expect(hasCapabilityLabel(id)).toBe(true);
    }
  });

  it('never returns the raw id for unknown ids (fallback is a neutral key)', () => {
    expect(capabilityLabelKey('totally.new.capability')).toBeNull();
    expect(hasCapabilityLabel('totally.new.capability')).toBe(false);
  });
});
