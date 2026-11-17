import { describe, expect, it } from 'bun:test';
import { parseFinancialReportResponse } from './parser.ts';
import { loadFixtureText } from './testing/load-fixture.ts';

function reportPayload(value: unknown, year: unknown = 2027): string {
  return JSON.stringify({
    symbol: 'NVDA.US',
    report: 'qf',
    list: {
      IS: {
        indicators: [{
          title: 'Income statement',
          accounts: [{
            field: 'ROE',
            name: 'ROE',
            values: [
              { fp_end: '1777176000', period: 'Q1 2027', year, value, ratio: '', yoy: '' },
              { fp_end: '1769317200', period: 'Q4 2026', year: 2026, value: '12.5' },
            ],
          }],
        }],
      },
    },
  });
}

const missingValues: Array<[string, unknown]> = [
  ['omitted', undefined],
  ['empty', ''],
  ['whitespace', ' \t '],
  ['null', null],
  ['invalid', 'not reported'],
  ['NaN', 'NaN'],
  ['Infinity', 'Infinity'],
  ['negative Infinity', '-Infinity'],
  ['boolean', true],
  ['array', []],
];

interface RawValue {
  fp_end: string;
  period: string;
  year: number;
  value: string;
}

interface RawStatement {
  indicators: Array<{ accounts: Array<{ field: string; values: RawValue[] }> }>;
}

describe('financial report missing values', () => {
  for (const [label, value] of missingValues) {
    it(`keeps a ${label} value missing without dropping its report period`, () => {
      const report = parseFinancialReportResponse(reportPayload(value));
      const values = report.statements.IS!.indicators[0].accounts[0].values;

      expect(values).toHaveLength(2);
      expect(values[0]).toMatchObject({ fpEnd: 1777176000, period: 'Q1 2027', year: 2027 });
      expect(values[0].value).toBeUndefined();
      expect(values[1].value).toBe(12.5);
    });
  }

  for (const value of [0, '0', '0.0000']) {
    it(`preserves the reported zero ${JSON.stringify(value)}`, () => {
      const report = parseFinancialReportResponse(reportPayload(value));
      expect(report.statements.IS!.indicators[0].accounts[0].values[0].value).toBe(0);
    });
  }

  it('preserves finite numbers and numeric strings, including negative values', () => {
    for (const value of [-12.5, '-12.5', ' 4.25 ']) {
      const report = parseFinancialReportResponse(reportPayload(value));
      expect(report.statements.IS!.indicators[0].accounts[0].values[0].value).toBe(Number(value));
    }
  });

  it('keeps the existing missing-year fallback unchanged', () => {
    const report = parseFinancialReportResponse(reportPayload('7.5', null));
    expect(report.statements.IS!.indicators[0].accounts[0].values[0]).toMatchObject({ year: 0, value: 7.5 });
  });

  it('retains all 80 captured empty values as missing and all 1135 reported values unchanged', () => {
    const text = loadFixtureText('financial-report');
    const raw = JSON.parse(text) as { list: Record<'IS' | 'BS' | 'CF', RawStatement> };
    const report = parseFinancialReportResponse(text);
    const missing: Array<number | undefined> = [];
    let reported = 0;

    for (const kind of ['IS', 'BS', 'CF'] as const) {
      const statement = report.statements[kind]!;
      raw.list[kind].indicators.forEach((indicator, indicatorIndex) => {
        indicator.accounts.forEach((account, accountIndex) => {
          const normalized = statement.indicators[indicatorIndex].accounts[accountIndex];
          expect(normalized.field).toBe(account.field);
          expect(normalized.values).toHaveLength(account.values.length);
          account.values.forEach((entry, valueIndex) => {
            const point = normalized.values[valueIndex];
            expect(point).toMatchObject({
              fpEnd: Number(entry.fp_end),
              period: entry.period,
              year: entry.year,
            });
            if (entry.value === '') missing.push(point.value);
            else {
              expect(point.value).toBe(Number(entry.value));
              reported += 1;
            }
          });
        });
      });
    }

    expect(missing).toHaveLength(80);
    expect(reported).toBe(1135);
    expect(missing.every((value) => value === undefined)).toBe(true);
  });
});
