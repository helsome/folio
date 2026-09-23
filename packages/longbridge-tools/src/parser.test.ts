import { describe, expect, it } from 'bun:test';
import { LongBridgeError } from './errors.ts';
import {
  parseCapitalFlowResponse,
  parseDepthResponse,
  parseInstitutionRatingResponse,
  parseMarketTemperatureResponse,
  parseQuoteResponse,
} from './parser.ts';

// The CLI marks a value it does not have with an empty string — the captured
// fixtures carry `"date": ""`, `"ratio": ""`, `"yoy": ""`, `"tip": ""`. For a
// required numeric field that marker must not be reported as a real 0.

function quote(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    symbol: 'AAPL.US',
    last_price: 195.5,
    prev_close: 194.25,
    timestamp: 1710000000,
    ...overrides,
  });
}

describe('parseQuoteResponse empty-value markers', () => {
  it('fails a blank last price instead of reporting 0', () => {
    expect(() => parseQuoteResponse(quote({ last_price: '', last: '' }))).toThrow(LongBridgeError);
    expect(() => parseQuoteResponse(quote({ last_price: '   ' }))).toThrow(LongBridgeError);
  });

  it('fails a blank previous close instead of reporting 0', () => {
    expect(() => parseQuoteResponse(quote({ prev_close: '' }))).toThrow(LongBridgeError);
  });

  it('falls back to the last price for blank open/high/low (never 0)', () => {
    const parsed = parseQuoteResponse(quote({ open: '', high: '', low: '' }));
    expect(parsed.lastPrice).toBe(195.5);
    expect(parsed.open).toBe(195.5);
    expect(parsed.high).toBe(195.5);
    expect(parsed.low).toBe(195.5);
  });

  it('falls back to the computed delta for a blank change/change_ratio', () => {
    const parsed = parseQuoteResponse(quote({ change: '', change_ratio: '' }));
    expect(parsed.change).toBeCloseTo(1.25, 10);
    expect(parsed.changePercent).toBeCloseTo((1.25 / 194.25) * 100, 10);
  });

  it('still treats a blank volume as 0', () => {
    expect(parseQuoteResponse(quote({ volume: '' })).volume).toBe(0);
  });

  it('parses the captured CLI payload (numbers delivered as strings)', () => {
    const captured = JSON.stringify([
      {
        symbol: 'AAPL.US',
        last: '276.830',
        high: '280.630',
        low: '274.860',
        open: '279.655',
        prev_close: '280.140',
        volume: 46668401,
        timestamp: '2026-05-05 12:36:35',
      },
    ]);
    const parsed = parseQuoteResponse(captured);
    expect(parsed.lastPrice).toBe(276.83);
    expect(parsed.open).toBe(279.655);
    expect(parsed.prevClose).toBe(280.14);
    expect(parsed.timestamp).toBe(Math.floor(Date.parse('2026-05-05 12:36:35') / 1000));
  });
});

describe('other parsers with empty-value markers', () => {
  it('fails blank depth prices instead of reporting 0-price levels', () => {
    const payload = JSON.stringify({
      symbol: 'AAPL.US',
      bids: [{ position: 1, price: '', volume: '100' }],
      asks: [],
    });
    expect(() => parseDepthResponse(payload)).toThrow(LongBridgeError);
  });

  it('keeps blank capital-flow buckets at 0', () => {
    const flow = parseCapitalFlowResponse(
      JSON.stringify({
        symbol: 'AAPL.US',
        timestamp: 1710000000,
        capital_in: { large: '', medium: '', small: '' },
        capital_out: { large: '', medium: '', small: '' },
      })
    );
    expect(flow.capitalIn).toEqual({ large: 0, medium: 0, small: 0 });
    expect(flow.capitalOut).toEqual({ large: 0, medium: 0, small: 0 });
  });

  it('keeps blank rating counts at 0', () => {
    const rating = parseInstitutionRatingResponse(
      JSON.stringify({ analyst: { evaluate: { buy: '', hold: '', sell: '', total: '' } } }),
      'AAPL.US'
    );
    expect(rating.analyst?.distribution).toMatchObject({ buy: 0, hold: 0, sell: 0, total: 0 });
  });

  it('keeps missing market-temperature fields at 0', () => {
    const temp = parseMarketTemperatureResponse(
      JSON.stringify([{ field: 'Market', value: 'US' }])
    );
    expect(temp.temperature).toBe(0);
    expect(temp.valuation).toBe(0);
    expect(temp.sentiment).toBe(0);
  });
});
