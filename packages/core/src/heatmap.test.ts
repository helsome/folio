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

  it('renders stale or unavailable returns gray, never as zero change', () => {
    const tile = { changePercent: null, state: 'unknown' } as Pick<HeatmapTile, 'state' | 'changePercent'>;
    expect(heatmapColor(tile)).toBe('#6b7280');
    expect(heatmapColor({ changePercent: 0, state: 'current' })).not.toBe('#6b7280');
    expect(heatmapColor({ changePercent: -4, state: 'stale' })).toBe('#6b7280');
  });
});
