import { describe, expect, it } from 'bun:test';
import type { RiskSeverity } from '@finagent/core';
import { createSyncI18n } from '@finagent/i18n';
import { severityVisual } from './portfolioRiskAtoms';

describe('severityVisual', () => {
  it('maps high severity to red', () => {
    expect(severityVisual('high')).toEqual({
      tone: 'high',
      color: 'var(--mac-red)',
      labelKey: 'portfolio.severity.high',
    });
  });

  it('maps medium severity to yellow', () => {
    expect(severityVisual('medium')).toEqual({
      tone: 'medium',
      color: 'var(--mac-yellow)',
      labelKey: 'portfolio.severity.medium',
    });
  });

  it('maps low severity to green', () => {
    expect(severityVisual('low')).toEqual({
      tone: 'low',
      color: 'var(--mac-green)',
      labelKey: 'portfolio.severity.low',
    });
  });

  it('returns a label key that resolves in every supported locale', () => {
    const severities: RiskSeverity[] = ['low', 'medium', 'high'];
    const en = createSyncI18n({ locale: 'en-US' });
    const zh = createSyncI18n({ locale: 'zh-CN' });
    for (const severity of severities) {
      const { labelKey } = severityVisual(severity);
      // A key absent from the bundles is echoed back verbatim; a localized copy
      // must differ from its English counterpart.
      expect(en.t(labelKey), `en-US ${severity}`).not.toBe(labelKey);
      expect(zh.t(labelKey), `zh-CN ${severity}`).not.toBe(labelKey);
      expect(zh.t(labelKey), `zh-CN vs en-US ${severity}`).not.toBe(en.t(labelKey));
    }
  });
});
