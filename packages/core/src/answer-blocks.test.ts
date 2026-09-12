import { describe, expect, it } from 'bun:test';
import {
  ANSWER_BLOCK_FENCE_LANG,
  ANSWER_BLOCK_SCHEMA_VERSION,
  parseAnswerBlock,
  validateAnswerBlock,
} from './answer-blocks.ts';

const metricGrid = {
  version: ANSWER_BLOCK_SCHEMA_VERSION,
  type: 'metric_grid',
  title: 'AAPL.US key metrics',
  evidenceIds: ['get_quote-1'],
  metrics: [
    {
      label: 'Last',
      value: 123.45,
      unit: 'price',
      currency: 'USD',
      asOf: '2026-01-15T00:00:00.000Z',
      change: 1.2,
      changePercent: 0.98,
      evidenceIds: ['get_quote-1'],
    },
    { label: 'Volume', value: 81234, unit: 'count' },
  ],
};

const dataTable = {
  version: ANSWER_BLOCK_SCHEMA_VERSION,
  type: 'data_table',
  columns: [
    { key: 'symbol', label: 'Symbol' },
    { key: 'value', label: 'Value', unit: 'price', currency: 'HKD' },
    { key: 'note', label: 'Note' },
  ],
  rows: [
    { symbol: '0700.HK', value: 320.4, note: '' },
    { symbol: 'AAPL.US', value: 123.45, note: null },
  ],
};

const timeSeries = {
  version: ANSWER_BLOCK_SCHEMA_VERSION,
  type: 'time_series_chart',
  unit: 'price',
  currency: 'USD',
  asOf: '2026-01-30T00:00:00.000Z',
  points: [
    { t: '2026-01-02T00:00:00.000Z', v: 100 },
    { t: '2026-01-03T00:00:00.000Z', v: 101.5 },
    { t: '2026-01-06T00:00:00.000Z', v: 99.8 },
  ],
};

const comparisonTable = {
  version: ANSWER_BLOCK_SCHEMA_VERSION,
  type: 'comparison_table',
  columns: [
    { id: 'AAPL.US', label: 'AAPL.US' },
    { id: 'MSFT.US', label: 'MSFT.US' },
  ],
  rows: [
    { label: 'Weight', unit: 'ratio', values: [0.42, 0.31] },
    { label: 'Day change', unit: 'percent', values: [1.2, null] },
  ],
};

describe('validateAnswerBlock', () => {
  it('accepts all four first-version block types', () => {
    for (const block of [metricGrid, dataTable, timeSeries, comparisonTable]) {
      const result = validateAnswerBlock(block);
      expect(result.ok).toBe(true);
    }
  });

  it('rejects a wrong schema version without throwing', () => {
    const result = validateAnswerBlock({ ...metricGrid, version: 2 });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unsupported_version');
  });

  it('rejects unknown block types', () => {
    const result = validateAnswerBlock({ ...metricGrid, type: 'dashboard' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unknown_type');
  });

  it('rejects non-objects and arrays', () => {
    expect(validateAnswerBlock('metric_grid').ok).toBe(false);
    expect(validateAnswerBlock([metricGrid]).ok).toBe(false);
    expect(validateAnswerBlock(null).ok).toBe(false);
  });

  it('requires a currency for price units and rejects bad currency codes', () => {
    const missingCurrency = {
      ...metricGrid,
      metrics: [{ label: 'Last', value: 1, unit: 'price' }],
    };
    expect(validateAnswerBlock(missingCurrency).ok).toBe(false);

    const badCode = {
      ...metricGrid,
      metrics: [{ label: 'Last', value: 1, unit: 'price', currency: 'us$' }],
    };
    expect(validateAnswerBlock(badCode).ok).toBe(false);
  });

  it('rejects non-finite numbers and non-numeric values', () => {
    const nan = {
      ...metricGrid,
      metrics: [{ label: 'Last', value: Number.NaN, unit: 'count' }],
    };
    expect(validateAnswerBlock(nan).ok).toBe(false);

    const string = {
      ...metricGrid,
      metrics: [{ label: 'Last', value: '123', unit: 'count' }],
    };
    expect(validateAnswerBlock(string).ok).toBe(false);
  });

  it('requires strictly ascending chart points', () => {
    const unsorted = {
      ...timeSeries,
      points: [
        { t: '2026-01-03T00:00:00.000Z', v: 100 },
        { t: '2026-01-02T00:00:00.000Z', v: 101 },
      ],
    };
    expect(validateAnswerBlock(unsorted).ok).toBe(false);
  });

  it('rejects oversized rows and metrics', () => {
    const manyMetrics = {
      ...metricGrid,
      metrics: Array.from({ length: 13 }, (_, index) => ({ label: `m${index}`, value: index, unit: 'count' })),
    };
    expect(validateAnswerBlock(manyMetrics).ok).toBe(false);

    const manyRows = {
      ...dataTable,
      rows: Array.from({ length: 51 }, (_, index) => ({ symbol: `S${index}` })),
    };
    expect(validateAnswerBlock(manyRows).ok).toBe(false);
  });

  it('rejects function values smuggled into cells', () => {
    const result = validateAnswerBlock({
      ...dataTable,
      rows: [{ symbol: () => 'eval', value: 1, note: null }],
    });
    expect(result.ok).toBe(false);
  });
});

describe('parseAnswerBlock', () => {
  it('round-trips a serialized block', () => {
    const raw = JSON.stringify(metricGrid);
    const result = parseAnswerBlock(raw);
    expect(result.ok).toBe(true);
    expect(result.block?.type).toBe('metric_grid');
  });

  it('reports invalid JSON instead of throwing', () => {
    const result = parseAnswerBlock('{"version":1,"type":"metric_grid"');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid_json');
  });

  it('keeps the fence language constant for the renderer contract', () => {
    expect(ANSWER_BLOCK_FENCE_LANG).toBe('folio-block');
  });
});
