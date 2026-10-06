/**
 * Locale-policy regression guard for date/time rendering.
 *
 * Several surfaces formatted dates with `new Date(x).toLocaleString()` (and
 * `toLocaleDateString` / `toLocaleTimeString`), which resolves against the
 * **host** locale. `@finagent/i18n` documents the opposite contract —
 * `format.ts` owns "how money/percent/dates render", `i18nCurrentLocale()`
 * exists so a renderer never reads the host locale, and `lib/money.ts` states
 * that "the OS locale no longer participates". A zh-CN user on an en-US host
 * (or the reverse) therefore saw dates in the wrong locale.
 *
 * Each case pins the app locale to one that renders observably differently from
 * the host locale for the same instant. A surface that still delegates to the
 * host locale cannot satisfy the assertion, so the guard cannot pass by
 * coincidence.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import {
  createSyncI18n,
  formatDate,
  formatDateTime,
  formatMarketTime,
  i18nCurrentLocale,
  i18nSetCurrentLocale,
  type I18nInstance,
  type SupportedLocale,
} from '@finagent/i18n';
import type {
  ResearchDiff,
  ResearchReport,
  ResearchSection,
  ThesisImpact,
} from '@finagent/core';
import { fallbackClient, FinagentClientProvider, type FinagentClient } from '../client';
import { installHappyDom } from '../test/setupHappyDom';
import { DataFreshness } from '../components/primitives/DataFreshness';
import { EvidenceList } from '../components/research/EvidenceList';
import { WhatChangedSection } from '../components/research/WhatChangedSection';
import { ResearchReportView } from '../components/research/ResearchReportView';
import { ThesisImpactList } from '../components/thesis/ThesisImpactList';
import { ConnectionCard } from '../components/settings/ConnectionCard';
import type { ConnectionEntry } from '../client/connections';

let restoreDom: (() => void) | undefined;
let savedLocale: SupportedLocale;
let i18n: I18nInstance;

beforeAll(() => {
  savedLocale = i18nCurrentLocale();
  restoreDom = installHappyDom().restore;
  // Real bundle (every namespace) so `t()` resolves; created after the locale
  // snapshot because it syncs the module-level formatter locale to en-US.
  i18n = createSyncI18n({ locale: 'en-US' });
});

afterAll(() => {
  // The formatter locale is module-global: leaking it would silently change
  // other test files' expectations.
  i18nSetCurrentLocale(savedLocale);
  restoreDom?.();
});

/** 2024-11-21T09:20:00Z — epoch ms, the unit every call site already passed to `new Date()`. */
const TS = Date.UTC(2024, 10, 21, 9, 20, 0);

/**
 * Pin the app locale to one whose formatter output differs from what the host
 * locale produced for the same instant, and return that expected string.
 * Throwing here (rather than skipping) keeps the guard honest: a vacuous
 * assertion must fail loudly, not pass silently.
 */
function pin(hostText: string, render: (locale: SupportedLocale) => string): string {
  for (const locale of ['zh-CN', 'en-US'] as const) {
    const expected = render(locale);
    if (expected !== hostText) return expected;
  }
  throw new Error(
    `host locale renders ${JSON.stringify(hostText)} identically to both supported locales — the assertion would be vacuous`,
  );
}

function renderText(element: React.ReactElement, client?: FinagentClient): string {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const tree = client ? (
    <FinagentClientProvider client={client}>
      <I18nextProvider i18n={i18n}>{element}</I18nextProvider>
    </FinagentClientProvider>
  ) : (
    <I18nextProvider i18n={i18n}>{element}</I18nextProvider>
  );
  act(() => {
    root.render(tree);
  });
  return container.textContent ?? '';
}

describe('date/time rendering follows the i18n locale policy, not the host locale', () => {
  it('DataFreshness renders the freshness clock through formatMarketTime', () => {
    const host = new Date(TS).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const expected = pin(host, (locale) => {
      i18nSetCurrentLocale(locale);
      return formatMarketTime(TS);
    });
    expect(expected).not.toBe(host);

    const text = renderText(<DataFreshness providerName="Longbridge" updatedAtMs={TS} />);
    expect(text).toContain(expected);
  });

  it('EvidenceList renders the fetch time through formatMarketTime', () => {
    const host = new Date(TS).toLocaleTimeString();
    const expected = pin(host, (locale) => {
      i18nSetCurrentLocale(locale);
      return formatMarketTime(TS);
    });

    const section: ResearchSection = {
      key: 'valuation',
      title: 'Valuation',
      verdict: 'neutral',
      summary: 'summary',
      evidence: [{ capabilityId: 'market.quote', runId: 'run-1', claim: 'claim', fetchedAt: TS }],
    };
    expect(renderText(<EvidenceList section={section} />)).toContain(expected);
  });

  it('WhatChangedSection renders the previous-report date through formatDate', () => {
    const host = new Date(TS).toLocaleDateString();
    const expected = pin(host, (locale) => {
      i18nSetCurrentLocale(locale);
      return formatDate(TS);
    });

    const diff: ResearchDiff = {
      id: 'diff-1',
      symbol: 'NVDA.US',
      previousReportId: 'prev-1',
      currentReportId: 'cur-1',
      generatedAt: TS,
      changes: [],
      material: false,
      summary: 'test diff',
    };
    const previousReport = { id: 'prev-1', symbol: 'NVDA.US', generatedAt: TS } as ResearchReport;
    expect(renderText(<WhatChangedSection diff={diff} previousReport={previousReport} />)).toContain(expected);
  });

  it('ResearchReportView renders the generated-at line through formatDateTime', () => {
    const host = new Date(TS).toLocaleString();
    const expected = pin(host, (locale) => {
      i18nSetCurrentLocale(locale);
      return formatDateTime(TS);
    });

    const report = {
      id: 'report-1',
      symbol: 'NVDA.US',
      generatedAt: TS,
      stance: 'neutral',
      confidence: 0.5,
      summary: 'summary',
      sections: [],
      capabilityRuns: [],
      runStatus: 'completed',
      bullCase: [],
      bearCase: [],
      catalysts: [],
      risks: [],
    } as unknown as ResearchReport;
    expect(renderText(<ResearchReportView report={report} />, fallbackClient)).toContain(expected);
  });

  it('ThesisImpactList renders the evaluation date through formatDate', () => {
    const host = new Date(TS).toLocaleDateString();
    const expected = pin(host, (locale) => {
      i18nSetCurrentLocale(locale);
      return formatDate(TS);
    });

    const impact: ThesisImpact = {
      id: 'impact-1',
      thesisId: 'thesis-1',
      symbol: 'NVDA.US',
      evaluatedAt: TS,
      kind: 'weakened',
      summary: 'weakened by a downgrade',
      evidence: [],
      thesis: {
        id: 'thesis-1',
        symbol: 'NVDA.US',
        stance: 'bullish',
        summary: 'AI demand keeps compounding.',
        bullCase: [],
        bearCase: [],
        catalysts: [],
        risks: [],
        evidenceRefs: [],
        createdAt: TS,
        updatedAt: TS,
        lastReviewedAt: TS,
      },
    };
    expect(renderText(<ThesisImpactList impacts={[impact]} />)).toContain(expected);
  });

  it('ConnectionCard renders the last health check through formatDateTime', () => {
    const host = new Date(TS).toLocaleString();
    const expected = pin(host, (locale) => {
      i18nSetCurrentLocale(locale);
      return formatDateTime(TS);
    });

    const entry = {
      providerId: 'longbridge',
      kind: 'broker-account',
      name: 'Longbridge',
      status: 'connected',
      health: { status: 'connected', lastCheck: TS },
      coverage: null,
      configurable: false,
      configured: true,
      hasAccount: true,
      accountLabel: null,
      error: null,
    } as unknown as ConnectionEntry;
    const text = renderText(
      <ConnectionCard entry={entry} onChanged={() => {}} />,
      fallbackClient,
    );
    expect(text).toContain(expected);
  });
});
