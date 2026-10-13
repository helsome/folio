import { describe, expect, it } from 'bun:test';
import type {
  CapabilityId,
  FinancialDataProvider,
  FinancialReport,
  ProviderResult,
  Quote,
} from '@finagent/core';
import { buildFinancialEvidence } from '../evidence/financial-evidence.ts';
import { createCompanyFinancialsCapability } from '../capabilities/manifests/phase-two.ts';
import { createMarketQuoteCapability } from '../capabilities/manifests/market-quote.ts';
import { ProviderRouter } from './router.ts';
import { createRouterFetchers } from './router-fetchers.ts';
import { reconcileFinancialReportResults } from './financial-report-reconciliation.ts';

function provider(id: string, capability: CapabilityId, data: unknown): FinancialDataProvider {
  return {
    kind: 'financial-data',
    id,
    name: id,
    async status() { return { status: 'connected', lastCheck: 0 }; },
    capabilities() { return [capability]; },
    markets() { return [{ id: 'US', name: 'United States' }]; },
    async execute<T>(): Promise<ProviderResult<T>> {
      return {
        ok: true,
        data: data as T,
        provenance: { providerId: id, providerName: id, fetchedAt: 1_700_000_000_000, stale: false },
      };
    },
  };
}

function routerWith(capability: CapabilityId, primary: unknown, fallback: unknown): ProviderRouter {
  const router = new ProviderRouter();
  router.register(provider('primary', capability, primary));
  router.register(provider('fallback', capability, fallback));
  router.setRouting({ primary: 'primary', fallback: 'fallback' });
  return router;
}

function quote(price: number, timestamp = 1_700_000_000): Quote {
  return {
    symbol: 'AAPL.US',
    instrumentId: 'AAPL.US',
    lastPrice: price,
    timestamp,
    change: 0,
    changePercent: 0,
    volume: 100,
    high: price,
    low: price,
    open: price,
    prevClose: price,
  };
}

function report(value: number, currency = 'USD'): FinancialReport {
  return {
    symbol: 'AAPL.US',
    instrumentId: 'AAPL.US',
    report: 'qf',
    statements: {
      IS: {
        indicators: [{
          title: 'Earnings',
          currency,
          accounts: [{
            field: 'Revenue',
            name: 'Revenue',
            values: [{ fpEnd: 1_735_689_600, period: 'Q4 2024', year: 2024, value }],
          }],
        }],
      },
    },
  };
}

describe('live router comparison paths', () => {
  it('exposes two quote candidates and a material conflict to the agent and evidence', async () => {
    const fetchers = createRouterFetchers(routerWith('market.quote', quote(100), quote(130)));
    const result = await createMarketQuoteCapability(fetchers).execute({ symbol: 'AAPL.US' }, {});
    expect(result.provenance.provider).toBe('primary');
    expect(result.summary).toContain('Provider price conflict');
    const comparison = result.evidence?.reconciliation?.comparisons?.[0].result;
    expect(comparison?.state).toBe('material-conflict');
    expect(comparison?.candidates.map((candidate) => [candidate.provider, candidate.value]))
      .toEqual([['primary', 100], ['fallback', 130]]);

    const [record] = buildFinancialEvidence({
      sessionId: 's',
      runId: 'r',
      toolCalls: [{
        id: 'quote-1',
        toolName: 'get_quote',
        args: { symbol: 'AAPL.US' },
        startedAt: 1,
        status: 'success',
        result,
      }],
    });
    expect(record.reconciliation?.comparisons?.[0].result.state).toBe('material-conflict');
  });

  it('does not compare a delayed quote with a current quote', async () => {
    const fetchers = createRouterFetchers(
      routerWith('market.quote', quote(100), quote(130, 1_699_900_000))
    );
    const result = await createMarketQuoteCapability(fetchers).execute({ symbol: 'AAPL.US' }, {});
    expect(result.evidence?.reconciliation?.comparisons?.[0].result.state).toBe('incomparable');
    expect(result.summary).toContain('cannot be directly compared');
  });

  it('compares equal financial statement fields and preserves mismatched currency', async () => {
    const matching = createRouterFetchers(
      routerWith('company.financials', report(100), report(130))
    );
    const conflict = await createCompanyFinancialsCapability(matching).execute(
      { symbol: 'AAPL.US' }, {}
    );
    expect(conflict.evidence?.reconciliation?.comparisons?.[0].result.state)
      .toBe('material-conflict');
    expect(conflict.summary).toContain('IS.Revenue');
    expect(conflict.provenance.provider).toBe('primary');

    const mismatched = createRouterFetchers(
      routerWith('company.financials', report(100, 'USD'), report(130, 'HKD'))
    );
    const incomparable = await createCompanyFinancialsCapability(mismatched).execute(
      { symbol: 'AAPL.US' }, {}
    );
    expect(incomparable.evidence?.reconciliation?.comparisons?.[0].result.state)
      .toBe('incomparable');
    expect(incomparable.summary).toContain('do not infer agreement');
  });

  it('applies a versioned, field-specific tolerance without losing raw candidates', async () => {
    const router = routerWith('company.financials', report(100), report(104));
    const results = await router.executeAll<FinancialReport>('company.financials', { symbol: 'AAPL.US' });
    const reconciled = reconcileFinancialReportResults(
      results,
      (metric) => metric === 'IS.Revenue' ? { relativeTolerance: 0.05 } : {}
    );
    expect(reconciled.comparisons[0].result.state).toBe('within-tolerance');
    expect(reconciled.comparisons[0].result.policyVersion).toBe('folio-financial-report/v1');
    expect(reconciled.comparisons[0].result.candidates.map((candidate) => candidate.value))
      .toEqual([100, 104]);
  });

  it('uses only an explicitly sourced FX fixing for cross-currency reports', async () => {
    const router = routerWith('company.financials', report(100, 'USD'), report(50, 'EUR'));
    const results = await router.executeAll<FinancialReport>('company.financials', { symbol: 'AAPL.US' });
    const asOf = 1_735_689_600_000;
    const reconciled = reconcileFinancialReportResults(results, () => ({
      version: 'fixture-fx/1',
      currencyConversions: [{ from: 'EUR', to: 'USD', factor: 2, asOf, source: 'fixture fixing' }],
      maxConversionSkewMs: 0,
    }));
    const comparison = reconciled.comparisons[0].result;
    expect(comparison.state).toBe('agreement');
    expect(comparison.policyVersion).toBe('fixture-fx/1');
    expect(comparison.candidates.map((candidate) => candidate.value)).toEqual([100, 50]);
    expect(comparison.normalizations?.[1].comparableValue).toBe(100);
    expect(comparison.normalizations?.[1].conversions[0].source).toBe('fixture fixing');
  });

  it('uses a field-specific provider priority for a material conflict', async () => {
    const router = routerWith('company.financials', report(100), report(130));
    const results = await router.executeAll<FinancialReport>('company.financials', { symbol: 'AAPL.US' });
    const reconciled = reconcileFinancialReportResults(results, (metric) => metric === 'IS.Revenue'
      ? { version: 'revenue-priority/1', providerPriority: ['fallback', 'primary'] }
      : {});
    const comparison = reconciled.comparisons[0].result;
    expect(comparison.state).toBe('material-conflict');
    expect(comparison.selected?.provider).toBe('fallback');
    expect(comparison.selectedReason).toContain('policy priority');
    expect(comparison.policyVersion).toBe('revenue-priority/1');
  });

  it('applies field policy through the live capability path', async () => {
    const fetchers = createRouterFetchers(
      routerWith('company.financials', report(100), report(130)),
      { financialReconciliationPolicy: (metric) => metric === 'IS.Revenue'
        ? { version: 'revenue-priority/1', providerPriority: ['fallback', 'primary'] }
        : {} }
    );
    const result = await createCompanyFinancialsCapability(fetchers).execute({ symbol: 'AAPL.US' }, {});
    const comparison = result.evidence?.reconciliation?.comparisons?.[0].result;
    expect(comparison?.state).toBe('material-conflict');
    expect(comparison?.selected?.provider).toBe('fallback');
    expect(comparison?.policyVersion).toBe('revenue-priority/1');
    expect(result.summary).toContain('Provider disagreement');
  });

  it('uses a dated sourced balance-sheet rate and preserves the originals', async () => {
    const usd = report(100, 'USD');
    const eur = report(50, 'EUR');
    usd.statements.BS = usd.statements.IS;
    eur.statements.BS = eur.statements.IS;
    delete usd.statements.IS;
    delete eur.statements.IS;
    const asOf = 1_735_689_600_000;
    const fetchers = createRouterFetchers(routerWith('company.financials', usd, eur), {
      currencyConversion: async (from, to, date) => ({
        from, to, factor: 2, asOf: date, source: 'dated fixture ECB fixing',
      }),
    });
    const result = await createCompanyFinancialsCapability(fetchers).execute({ symbol: 'AAPL.US' }, {});
    const comparison = result.evidence?.reconciliation?.comparisons?.[0].result;
    expect(comparison?.state).toBe('agreement');
    expect(comparison?.policyVersion).toBe('folio-financial-report-fx/v1');
    expect(comparison?.candidates.map((candidate) => candidate.value)).toEqual([100, 50]);
    expect(comparison?.normalizations?.[1].comparableValue).toBe(100);
    expect(comparison?.normalizations?.[1].conversions[0].source).toBe('dated fixture ECB fixing');
    expect(comparison?.normalizations?.[1].conversions[0].asOf).toBe(asOf);
  });

  it('does not treat a single-day FX fixing as a flow-statement period rate', async () => {
    let requested = false;
    const fetchers = createRouterFetchers(
      routerWith('company.financials', report(100, 'USD'), report(50, 'EUR')),
      { currencyConversion: async () => {
        requested = true;
        return { from: 'EUR', to: 'USD', factor: 2, asOf: 1_735_689_600_000, source: 'spot fixture' };
      } }
    );
    const result = await createCompanyFinancialsCapability(fetchers).execute({ symbol: 'AAPL.US' }, {});
    expect(result.evidence?.reconciliation?.comparisons?.[0].result.state).toBe('incomparable');
    expect(requested).toBe(false);
  });
});
