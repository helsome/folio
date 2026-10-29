import { describe, expect, it } from 'bun:test';
import { heatmapColor, heatmapHoldingValue, type HeatmapTile } from './heatmap.ts';

describe('heatmap value mapping', () => {
  it('uses only amounts in the selected base currency', () => {
    expect(heatmapHoldingValue({ symbol: 'AAPL.US', name: '', currency: 'USD', marketValue: 50, marketValueBase: 70 }, 'USD', 'USD'))
      .toEqual({ value: 70 });
    expect(heatmapHoldingValue({ symbol: '0700.HK', name: '', currency: 'HKD', marketValue: 50, marketValueBase: 70 }, 'USD', 'HKD'))
      .toEqual({ value: null, exclusion: 'currency' });
  });

  it('keeps missing, zero, and short positions explicit', () => {
    expect(heatmapHoldingValue({ symbol: 'A.US', name: '', currency: 'USD', marketValue: -2 }, 'USD', 'USD').exclusion).toBe('short');
    expect(heatmapHoldingValue({ symbol: 'A.US', name: '', currency: 'USD', marketValue: 0 }, 'USD', 'USD').exclusion).toBe('zero');
    expect(heatmapHoldingValue({ symbol: 'A.US', name: '', currency: 'USD' }, 'USD', 'USD').exclusion).toBe('missing-value');
  });

  it('keeps stale and unknown returns distinct from the neutral zero color', () => {
    expect(heatmapColor({ changePercent: null, state: 'unknown' })).toBe('#4b5563');
    expect(heatmapColor({ changePercent: -4, state: 'stale' })).toBe('#6b7280');
    expect(heatmapColor({ changePercent: 0, state: 'current' })).not.toBe('#4b5563');
  });

  it('uses a continuous capped red-to-green palette', () => {
    const colors = [-5, -3, -0.5, 0, 0.5, 3, 5].map((changePercent) => heatmapColor({ changePercent, state: 'current' }));
    expect(colors[0]).toBe(colors[1]);
    expect(colors[5]).toBe(colors[6]);
    expect(colors[0]).toBe('#f23645');
    expect(colors[3]).toBe('#343a40');
    expect(colors[5]).toBe('#089981');
    expect(new Set(colors).size).toBe(5);
  });
});
