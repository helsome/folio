import { describe, expect, it } from 'bun:test';
import type { PortfolioSnapshot } from '@finagent/core';
import { portfolioFailureFromError, portfolioFailureFromSnapshot } from './portfolioFailure';
import { formatMoney, formatPercent, formatSignedMoney } from './money';

function snapshot(overrides: Partial<PortfolioSnapshot> = {}): PortfolioSnapshot {
  return {
    baseCurrency: 'USD',
    accounts: [],
    holdings: [],
    fetchedAt: 1,
    ...overrides,
  };
}

describe('portfolioFailureFromError', () => {
  it('maps IPC error codes to the matching failure kind with a user-safe message', () => {
    expect(portfolioFailureFromError({ code: 'LONGBRIDGE_NOT_INSTALLED' }).kind).toBe('not-connected');
    expect(portfolioFailureFromError({ code: 'LONGBRIDGE_NOT_AUTHED' }).kind).toBe('no-account-permission');
    expect(portfolioFailureFromError({ code: 'LONGBRIDGE_TIMEOUT' }).kind).toBe('timeout');
    expect(portfolioFailureFromError({ code: 'LONGBRIDGE_PARSE_FAILURE' }).kind).toBe('parse-error');
    expect(portfolioFailureFromError({ code: 'UNKNOWN' }).kind).toBe('provider-error');
    expect(portfolioFailureFromError(new Error('boom')).kind).toBe('provider-error');
  });

  it('never echoes raw vendor output in the message', () => {
    const failure = portfolioFailureFromError({ code: 'LONGBRIDGE_PARSE_FAILURE', message: 'raw {{{}' });
    expect(failure.message).not.toContain('{{{');
  });
});

describe('portfolioFailureFromSnapshot', () => {
  it('derives empty when there are no holdings and no positive assets', () => {
    const failure = portfolioFailureFromSnapshot(snapshot({ totalAssets: 0, holdings: [] }));
    expect(failure?.kind).toBe('empty');
  });

  it('derives partial when totals exist but holdings are missing', () => {
    const failure = portfolioFailureFromSnapshot(snapshot({ totalAssets: 100, holdings: [] }));
    expect(failure?.kind).toBe('partial');
    expect(failure?.partialData).toBe(true);
  });

  it('returns undefined for a healthy snapshot', () => {
    expect(
      portfolioFailureFromSnapshot(
        snapshot({
          totalAssets: 100,
          holdings: [{ symbol: 'AAPL.US', name: 'Apple', marketValue: 100 }],
        })
      )
    ).toBeUndefined();
  });
});

describe('formatMoney (spec §17)', () => {
  it('renders undefined/NaN as an em dash, never [object Object]', () => {
    expect(formatMoney(undefined, 'USD')).toBe('—');
    expect(formatMoney(Number.NaN, 'USD')).toBe('—');
  });

  it('uses Intl currency formatting for supported codes and plain number + code otherwise', () => {
    expect(formatMoney(1234.5, 'USD')).toContain('1,234.5');
    expect(formatMoney(1234.5, 'HKD')).toContain('1,234.5');
    // Unknown code → plain number + ISO code, never a hardcoded $.
    expect(formatMoney(1234.5, 'BTC')).toBe('1,234.5 BTC');
    expect(formatMoney(1234.5, 'BTC')).not.toContain('$');
    expect(formatMoney(1234.5, undefined)).toBe('1,234.5');
  });
});

describe('formatSignedMoney / formatPercent', () => {
  it('prefixes gains with a plus sign', () => {
    expect(formatSignedMoney(10, 'USD')).toContain('+');
    expect(formatSignedMoney(-10, 'USD')).not.toContain('+');
    expect(formatPercent(2.5)).toBe('+2.50%');
    expect(formatPercent(-2.5)).toBe('-2.50%');
    expect(formatPercent(undefined)).toBe('—');
  });
});
