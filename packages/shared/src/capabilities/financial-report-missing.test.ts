import { describe, expect, it } from 'bun:test';
import type { FinancialReport } from '@finagent/core';
import { parseFinancialReportResponse } from '../../../longbridge-tools/src/parser.ts';
import { loadFixtureText } from '../../../longbridge-tools/src/testing/load-fixture.ts';
import { defaultCapabilityFetchers } from './fetchers.ts';
import { createCompanyFinancialsCapability } from './manifests/phase-two.ts';

describe('company.financials missing-value contract', () => {
  it('keeps captured missing periods distinct from zero through the real manifest and JSON wire', async () => {
    const report = parseFinancialReportResponse(loadFixtureText('financial-report'));
    const requests: unknown[][] = [];
    const capability = createCompanyFinancialsCapability({
      ...defaultCapabilityFetchers,
      getFinancialReport: async (...args) => {
        requests.push(args);
        return report;
      },
    });

    const result = await capability.execute({ symbol: ' nvda.us ' }, { now: () => 12345 });
    const wire = JSON.parse(JSON.stringify(result.data)) as FinancialReport;
    const accounts = wire.statements.CF!.indicators.flatMap((indicator) => indicator.accounts);

    expect(requests).toEqual([['NVDA.US', 'ALL', undefined]]);
    expect(result.provenance).toMatchObject({ provider: 'longbridge', fetchedAt: 12345 });
    for (const field of ['TotalDebtIssued', 'TotalDebtRepaid']) {
      const point = accounts.find((account) => account.field === field)!.values[0];
      expect(point).toMatchObject({ fpEnd: 1777176000, period: 'Q1 2027', year: 2027 });
      expect(point).not.toHaveProperty('value');
    }
  });

  it('preserves explicit reported zeros in the serialized capability data', async () => {
    const report = parseFinancialReportResponse(JSON.stringify({
      symbol: 'NVDA.US',
      report: 'qf',
      list: { CF: { indicators: [{ accounts: [{
        field: 'TotalDebtIssued',
        values: [{ fp_end: '1777176000', period: 'Q1 2027', year: 2027, value: '0' }],
      }] }] } },
    }));
    const capability = createCompanyFinancialsCapability({
      ...defaultCapabilityFetchers,
      getFinancialReport: async () => report,
    });

    const result = await capability.execute({ symbol: 'NVDA.US' }, {});
    const wire = JSON.parse(JSON.stringify(result.data)) as FinancialReport;
    expect(wire.statements.CF!.indicators[0].accounts[0].values[0].value).toBe(0);
  });
});
