import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { installHappyDom } from '../test/setupHappyDom';
import { writePersisted } from './persistedPrefs';
import {
  COMPARE_VIEW_SCHEMA_VERSION,
  createSavedCompareView,
  loadSavedCompareViews,
  parseSavedCompareViews,
  persistSavedCompareViews,
  removeSavedCompareView,
  savedCompareViewMatches,
  SAVED_COMPARE_VIEWS_STORAGE_KEY,
  updateCompareViewSettings,
  upsertSavedCompareView,
  type CompareViewSettings,
  visibleMetricIdsFor,
} from './compareViewState';

let restore: (() => void) | undefined;

beforeAll(() => {
  restore = installHappyDom().restore;
});

afterAll(() => {
  restore?.();
});

beforeEach(() => {
  window.localStorage.clear();
});

function savedView(id = 'view-1') {
  return createSavedCompareView({
    id,
    name: 'Mega-cap tech',
    symbols: ['aapl.us', 'MSFT.US', 'AAPL.US'],
    settings: {
      metricPreset: 'priceReturns',
      returnWindow: '1m',
      density: 'compact',
      visibleMetricIds: ['price', 'return1m', 'momentum'],
    },
    createdAt: 100,
    now: 200,
  });
}

describe('saved compare view schema', () => {
  it('stores exact visible metrics for a preset and return window', () => {
    expect(visibleMetricIdsFor('priceReturns', '1m')).toEqual([
      'price',
      'return1m',
      'momentum',
    ]);
    expect(visibleMetricIdsFor('valuation', '1y')).toEqual([
      'marketCap',
      'pe',
      'pb',
      'dividendYield',
    ]);
    expect(visibleMetricIdsFor('fundamentals', 'all')).toEqual([
      'revenueGrowth',
      'grossMargin',
      'roe',
      'analystRating',
    ]);
  });

  it('creates a versioned, normalized view with a fallback name', () => {
    const view = savedView();
    expect(view.schemaVersion).toBe(COMPARE_VIEW_SCHEMA_VERSION);
    expect(view.symbols).toEqual(['AAPL.US', 'MSFT.US']);
    expect(view.name).toBe('Mega-cap tech');
    expect(view.createdAt).toBe(100);
    expect(view.updatedAt).toBe(200);
    expect(view.settings.visibleMetricIds).toEqual(['price', 'return1m', 'momentum']);

    const unnamed = createSavedCompareView({
      name: ' ',
      symbols: ['NVDA.US', 'AMD.US'],
      settings: {
        metricPreset: 'all',
        returnWindow: 'all',
        density: 'comfortable',
        visibleMetricIds: ['price', 'marketCap'],
      },
      now: 300,
    });
    expect(unnamed.name).toBe('NVDA.US / AMD.US');
  });

  it('persists and reloads only valid v1 views', () => {
    const view = savedView();
    persistSavedCompareViews([view]);
    expect(loadSavedCompareViews()).toEqual([view]);

    writePersisted(SAVED_COMPARE_VIEWS_STORAGE_KEY, {
      schemaVersion: 2,
      views: [view],
    });
    expect(loadSavedCompareViews()).toEqual([]);

    expect(parseSavedCompareViews({
      schemaVersion: 1,
      views: [view, { ...view, id: '', schemaVersion: 1 }],
    })).toEqual([view]);
  });

  it('upserts by id and removes the selected view', () => {
    const first = savedView('first');
    const second = savedView('second');
    const updated = { ...first, name: 'Updated', updatedAt: 400 };

    expect(upsertSavedCompareView([first, second], updated)).toEqual([updated, second]);
    expect(removeSavedCompareView([updated, second], 'first')).toEqual([second]);
  });

  it('recomputes exact visible metrics only when display filters change', () => {
    const current: CompareViewSettings = {
      metricPreset: 'all',
      returnWindow: 'all',
      density: 'comfortable',
      visibleMetricIds: ['price', 'marketCap'],
    };
    expect(updateCompareViewSettings(current, { density: 'compact' }).visibleMetricIds)
      .toEqual(['price', 'marketCap']);
    expect(updateCompareViewSettings(current, { returnWindow: '3m' }).visibleMetricIds)
      .not.toContain('return1m');
  });

  it('matches a remounted workspace to its saved view', () => {
    const view = savedView();
    expect(savedCompareViewMatches(view, view.symbols, view.settings)).toBe(true);
    expect(savedCompareViewMatches(view, ['AAPL.US', 'NVDA.US'], view.settings)).toBe(false);
    expect(savedCompareViewMatches(view, view.symbols, {
      ...view.settings,
      density: 'comfortable',
    })).toBe(false);
  });
});
