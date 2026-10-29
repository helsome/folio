import { describe, expect, it } from 'bun:test';
import type { AlertRule, CalendarEvent, PortfolioSnapshot } from '@finagent/core';
import { parseCalendarResponse } from '@finagent/longbridge-tools';
import fixture from '../../../longbridge-tools/src/testing/fixtures/finance-calendar-events.json';
import { evaluateRule } from '../alerts/evaluators.ts';
import { CapabilityExecutor } from '../capabilities/executor.ts';
import type { CapabilityFetchers } from '../capabilities/fetchers.ts';
import {
  createResearchEventsCapability,
} from '../capabilities/manifests/phase-two.ts';
import { createPortfolioSummaryCapability } from '../capabilities/manifests/portfolio-summary.ts';
import { createCapabilityRegistry } from '../capabilities/registry.ts';
import { PortfolioRiskService } from '../portfolio-risk/service.ts';

const events = parseCalendarResponse(JSON.stringify(fixture));
const earningsRule: AlertRule = {
  id: 'earnings-window',
  type: 'earnings',
  symbol: 'NVDA.US',
  horizonDays: 7,
  createdAt: 0,
  enabled: true,
  cooldownMinutes: 0,
};

function registryFor(calendar: CalendarEvent[]) {
  const portfolio: PortfolioSnapshot = {
    baseCurrency: 'USD',
    totalAssets: 100,
    marketValue: 100,
    cash: 0,
    accounts: [],
    fetchedAt: 0,
    holdings: [{
      symbol: 'NVDA.US', name: 'NVIDIA', currency: 'USD', quantity: 1,
      costPrice: 100, marketPrice: 100, marketValue: 100,
      unrealizedPnL: 0, unrealizedPnLPercent: 0,
    }],
  };
  const fetchers = {
    getCalendarEvents: async () => calendar,
    getPortfolio: async () => portfolio,
  } as unknown as CapabilityFetchers;
  return createCapabilityRegistry([
    createResearchEventsCapability(fetchers),
    createPortfolioSummaryCapability(fetchers),
  ]);
}

async function checkBoth(calendar: CalendarEvent[], at: string, expected: boolean) {
  const nowMs = Date.parse(at);
  const registry = registryFor(calendar);
  const report = await new PortfolioRiskService({
    registry,
    executor: new CapabilityExecutor({ now: () => nowMs }),
    now: () => nowMs,
  }).analyze();
  expect(report.capabilityRuns.find((run) => run.capabilityId === 'research.events')?.status)
    .toBe('success');
  const alert = await evaluateRule(earningsRule, registry, { now: () => nowMs });
  expect({
    risk: report.signals.some((signal) => signal.kind === 'upcoming_earnings'),
    alert: alert !== null,
  }).toEqual({ risk: expected, alert: expected });
}

describe('earnings calendar date through production consumers', () => {
  it('retains the recorded after-market announcement on its market-local day', async () => {
    expect(fixture.list[0].infos[0].date_type).toBe('盘后');
    expect(events[0].localDate).toBe('2026-05-20');
    expect(new Date(events[0].date * 1000).toISOString()).toBe('2026-05-20T00:00:00.000Z');
    await checkBoth(events, '2026-05-20T12:00:00Z', true); // 08:00 New York
  });

  it('keeps the date-only event through the New York evening after UTC midnight', async () => {
    await checkBoth(events, '2026-05-21T02:00:00Z', true); // May 20 22:00 New York
  });

  it('expires the date-only event when the next market-local day starts', async () => {
    await checkBoth(events, '2026-05-21T04:00:00Z', false); // May 21 00:00 New York
  });

  it('preserves exact timestamp expiry even when a local date is present', async () => {
    const precise = [{ ...events[0], date: Date.parse('2026-05-20T10:00:00Z') / 1000 }];
    await checkBoth(precise, '2026-05-20T12:00:00Z', false);
  });

  it('preserves timestamp expiry for legacy events without a local date', async () => {
    const { localDate: _localDate, ...legacy } = events[0];
    await checkBoth([legacy], '2026-05-20T12:00:00Z', false);
  });
});
