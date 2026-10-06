import { describe, expect, it } from 'bun:test';
import type { PortfolioFailure, PortfolioFailureKind, PortfolioSnapshot } from '@finagent/core';
import { createSyncI18n } from '@finagent/i18n';
import {
  portfolioFailureDetail,
  portfolioFailureDiagnostic,
  portfolioFailureFromError,
  portfolioFailureFromSnapshot,
} from './portfolioFailure';
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

describe('portfolioFailureDiagnostic', () => {
  it('hides the fixed per-kind sentence so the UI renders localized copy instead', () => {
    // Every known code resolves to a hardcoded English KIND_MESSAGES sentence;
    // showing it verbatim is the bug this predicate exists to prevent.
    expect(
      portfolioFailureDiagnostic(portfolioFailureFromError({ code: 'LONGBRIDGE_TIMEOUT' }))
    ).toBeUndefined();
    expect(
      portfolioFailureDiagnostic(
        portfolioFailureFromSnapshot(snapshot({ totalAssets: 100, holdings: [] })) as PortfolioFailure
      )
    ).toBeUndefined();
  });

  it('surfaces a real envelope message for provider-error', () => {
    const failure = portfolioFailureFromError({
      code: 'SOMETHING_ELSE',
      message: 'connection is locked',
    });
    expect(portfolioFailureDiagnostic(failure)).toBe('connection is locked');
  });

  it('returns undefined when provider-error has no usable message', () => {
    expect(portfolioFailureDiagnostic(portfolioFailureFromError(undefined))).toBeUndefined();
    expect(
      portfolioFailureDiagnostic(
        portfolioFailureFromError({ code: 'SOMETHING_ELSE', message: '   ' })
      )
    ).toBeUndefined();
  });
});

describe('portfolioFailureDetail', () => {
  const ALL_KINDS: Record<PortfolioFailureKind, true> = {
    'not-connected': true,
    'no-account-permission': true,
    empty: true,
    partial: true,
    'provider-error': true,
    'parse-error': true,
    timeout: true,
  };

  const translate = (locale: 'en-US' | 'zh-CN') => {
    const i18n = createSyncI18n({ locale });
    return (key: string, options?: Record<string, unknown>): string => i18n.t(key, options);
  };

  it('renders copy for every kind and resolves it per locale', () => {
    const zh = translate('zh-CN');
    const en = translate('en-US');
    for (const kind of Object.keys(ALL_KINDS) as PortfolioFailureKind[]) {
      // Empty message => every kind falls back to its locale copy (see the next
      // case for the provider-error diagnostic pass-through).
      const failure: PortfolioFailure = { kind, message: '' };
      const zhText = portfolioFailureDetail(zh, failure);
      const enText = portfolioFailureDetail(en, failure);
      expect(zhText).not.toContain('portfolio.failureDetail');
      expect(enText).not.toContain('portfolio.failureDetail');
      expect(zhText).not.toBe(enText);
    }
  });

  it('never surfaces the English table sentence', () => {
    const zh = translate('zh-CN');
    for (const kind of Object.keys(ALL_KINDS) as PortfolioFailureKind[]) {
      if (kind === 'provider-error') continue;
      expect(
        portfolioFailureDetail(zh, { kind, message: 'expected English table sentence' })
      ).not.toContain('expected English table sentence');
    }
  });

  it('still surfaces a provider-error diagnostic verbatim', () => {
    expect(
      portfolioFailureDetail(translate('zh-CN'), {
        kind: 'provider-error',
        message: 'connection is locked',
      })
    ).toBe('connection is locked');
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
    expect(formatPercent(2.5)).toBe('+2.5%');
    expect(formatPercent(-2.5)).toBe('-2.5%');
    expect(formatPercent(undefined)).toBe('—');
  });
});

describe('money formatting follows the UI locale (issue #86)', () => {
  it('renders USD through the active i18n locale, never the OS locale', async () => {
    const { i18nSetCurrentLocale } = await import('@finagent/i18n');
    try {
      i18nSetCurrentLocale('en-US');
      expect(formatMoney(12345.67, 'USD')).toBe('$12,345.67');
      i18nSetCurrentLocale('zh-CN');
      expect(formatMoney(12345.67, 'USD')).toBe('US$12,345.67');
    } finally {
      i18nSetCurrentLocale('en-US');
    }
  });
});
