import { describe, expect, it } from 'bun:test';
import { parseAnswerBlock } from '@finagent/core';
import type { Kline, PortfolioSnapshot, Quote } from '@finagent/core';
import {
  appendBlocksToAnswer,
  buildPortfolioTableBlock,
  buildQuoteAnswerBlocks,
  buildRiskComparisonBlock,
  currencyForSymbol,
  dailyVolatility,
  renderBlockFence,
} from './answer-block-emitter.ts';

const quote: Quote = {
  symbol: 'AAPL.US',
  lastPrice: 123.45,
  change: 1.2,
  changePercent: 0.98,
  volume: 81234,
  timestamp: Date.parse('2026-01-15T00:00:00.000Z'),
  high: 124,
  low: 121,
  open: 122,
  prevClose: 122.25,
};

function klineSeries(): Kline[] {
  return Array.from({ length: 5 }, (_, index) => ({
    symbol: 'AAPL.US',
    timestamp: Date.parse(`2026-01-${10 + index}T00:00:00.000Z`),
    open: 100 + index,
    high: 101 + index,
    low: 99 + index,
    close: 100.5 + index,
    volume: 1000 + index,
  }));
}

describe('buildQuoteAnswerBlocks', () => {
  it('emits a KPI grid and a chart that both pass schema validation', () => {
    const blocks = buildQuoteAnswerBlocks(quote, klineSeries(), ['get_quote-1', 'get_kline-1']);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe('metric_grid');
    expect(blocks[1].type).toBe('time_series_chart');
    for (const block of blocks) {
      const result = parseAnswerBlock(JSON.stringify(block));
      expect(result.ok).toBe(true);
    }
  });

  it('omits the chart when no usable series exists, keeping the KPI grid', () => {
    const blocks = buildQuoteAnswerBlocks(quote, [], ['get_quote-1']);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('metric_grid');
  });

  it('stamps a given source slug onto every block', () => {
    const blocks = buildQuoteAnswerBlocks(quote, klineSeries(), ['get_quote-1'], 'demo');
    for (const block of blocks) {
      if (block.type === 'metric_grid' || block.type === 'time_series_chart') {
        expect(block.source).toBe('demo');
      }
      expect(parseAnswerBlock(JSON.stringify(block)).ok).toBe(true);
    }
  });

  it('derives display currency from the symbol suffix', () => {
    expect(currencyForSymbol('0700.HK')).toBe('HKD');
    expect(currencyForSymbol('600519.SH')).toBe('CNY');
    expect(currencyForSymbol('AAPL.US')).toBe('USD');
  });

  it('sorts chart points ascending even when the source series is not', () => {
    const reversed = [...klineSeries()].reverse();
    const blocks = buildQuoteAnswerBlocks(quote, reversed, ['get_quote-1']);
    const chart = blocks.find((block) => block.type === 'time_series_chart');
    expect(chart?.type).toBe('time_series_chart');
    if (chart?.type === 'time_series_chart') {
      const times = chart.points.map((point) => point.t);
      expect([...times].sort()).toEqual(times);
    }
  });
});

describe('buildPortfolioTableBlock', () => {
  it('builds a validated holdings table from a snapshot', () => {
    const snapshot: PortfolioSnapshot = {
      accounts: [],
      holdings: [
        { symbol: 'AAPL.US', name: 'Apple', quantity: 10, marketValueBase: 1234.5, unrealizedPnLPercent: 2.5 },
        { symbol: '0700.HK', name: 'Tencent', quantity: 100, marketValueBase: 500, unrealizedPnLPercent: -1.2 },
      ],
      totalAssets: 1734.5,
      fetchedAt: Date.now(),
    };
    const block = buildPortfolioTableBlock(snapshot, ['get_portfolio-1']);
    expect(block?.type).toBe('data_table');
    if (block?.type === 'data_table') {
      expect(block.rows).toHaveLength(2);
      expect(parseAnswerBlock(JSON.stringify(block)).ok).toBe(true);
    }
  });

  it('returns null for an empty portfolio instead of an empty block', () => {
    const snapshot: PortfolioSnapshot = { accounts: [], holdings: [], fetchedAt: Date.now() };
    expect(buildPortfolioTableBlock(snapshot, ['get_portfolio-1'])).toBeNull();
  });
});

describe('buildRiskComparisonBlock', () => {
  it('builds a validated comparison for multiple positions', () => {
    const block = buildRiskComparisonBlock(
      [
        { symbol: 'AAPL.US', weight: 0.6, volatility: 0.02, dayChangePercent: 1.2 },
        { symbol: '0700.HK', weight: 0.4, volatility: 0.03, dayChangePercent: -0.4 },
      ],
      ['get_portfolio-1']
    );
    expect(block?.type).toBe('comparison_table');
    if (block) expect(parseAnswerBlock(JSON.stringify(block)).ok).toBe(true);
  });

  it('returns null when there is nothing to compare', () => {
    expect(
      buildRiskComparisonBlock([{ symbol: 'AAPL.US', weight: 1, volatility: null, dayChangePercent: null }], ['x'])
    ).toBeNull();
  });
});

describe('dailyVolatility / appendBlocksToAnswer', () => {
  it('computes a finite volatility for a usable series and null otherwise', () => {
    expect(dailyVolatility(klineSeries())).toBeGreaterThan(0);
    expect(dailyVolatility([])).toBeNull();
  });

  it('appends fences after the answer text with a blank line', () => {
    const blocks = buildQuoteAnswerBlocks(quote, klineSeries(), ['get_quote-1']);
    const answer = appendBlocksToAnswer('Summary text.', blocks);
    expect(answer.startsWith('Summary text.\n\n```folio-block\n')).toBe(true);
    expect(answer.endsWith('```')).toBe(true);
  });

  it('returns the answer untouched when there are no blocks', () => {
    expect(appendBlocksToAnswer('Summary text.', [])).toBe('Summary text.');
  });
});
