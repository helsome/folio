import { readPersisted, writePersisted } from './persistedPrefs';

export const COMPARE_VIEW_SCHEMA_VERSION = 1 as const;
export const SAVED_COMPARE_VIEWS_STORAGE_KEY = 'compare.savedViews.v1';
export const LAST_SAVED_COMPARE_VIEW_STORAGE_KEY = 'compare.savedViews.lastSelected.v1';

export const COMPARE_METRIC_IDS = [
  'price',
  'marketCap',
  'pe',
  'pb',
  'revenueGrowth',
  'grossMargin',
  'roe',
  'dividendYield',
  'return1m',
  'return3m',
  'return1y',
  'analystRating',
  'momentum',
] as const;

export type CompareMetricId = (typeof COMPARE_METRIC_IDS)[number];
export type CompareMetricPreset = 'all' | 'priceReturns' | 'valuation' | 'fundamentals';
export type CompareReturnWindow = 'all' | '1m' | '3m' | '1y';
export type CompareRowDensity = 'comfortable' | 'compact';

export interface CompareViewSettings {
  metricPreset: CompareMetricPreset;
  returnWindow: CompareReturnWindow;
  density: CompareRowDensity;
  visibleMetricIds: CompareMetricId[];
}

export interface CompareMetricDefinition {
  id: CompareMetricId;
  rowMetric: string;
  labelKey: string;
  preset: Exclude<CompareMetricPreset, 'all'>;
}

export const COMPARE_METRIC_DEFINITIONS = [
  { id: 'price', rowMetric: 'Price', labelKey: 'compare.metrics.price', preset: 'priceReturns' },
  { id: 'marketCap', rowMetric: 'Market Cap', labelKey: 'compare.metrics.marketCap', preset: 'valuation' },
  { id: 'pe', rowMetric: 'PE', labelKey: 'compare.metrics.pe', preset: 'valuation' },
  { id: 'pb', rowMetric: 'PB', labelKey: 'compare.metrics.pb', preset: 'valuation' },
  { id: 'revenueGrowth', rowMetric: 'Revenue Growth', labelKey: 'compare.metrics.revenueGrowth', preset: 'fundamentals' },
  { id: 'grossMargin', rowMetric: 'Gross Margin', labelKey: 'compare.metrics.grossMargin', preset: 'fundamentals' },
  { id: 'roe', rowMetric: 'ROE', labelKey: 'compare.metrics.roe', preset: 'fundamentals' },
  { id: 'dividendYield', rowMetric: 'Dividend Yield', labelKey: 'compare.metrics.dividendYield', preset: 'valuation' },
  { id: 'return1m', rowMetric: '1M Return', labelKey: 'compare.metrics.return1m', preset: 'priceReturns' },
  { id: 'return3m', rowMetric: '3M Return', labelKey: 'compare.metrics.return3m', preset: 'priceReturns' },
  { id: 'return1y', rowMetric: '1Y Return', labelKey: 'compare.metrics.return1y', preset: 'priceReturns' },
  { id: 'analystRating', rowMetric: 'Analyst Rating', labelKey: 'compare.metrics.analystRating', preset: 'fundamentals' },
  { id: 'momentum', rowMetric: 'Momentum', labelKey: 'compare.metrics.momentum', preset: 'priceReturns' },
] as const satisfies readonly CompareMetricDefinition[];

export const DEFAULT_COMPARE_VIEW_SETTINGS = {
  metricPreset: 'all',
  returnWindow: 'all',
  density: 'comfortable',
  visibleMetricIds: [...COMPARE_METRIC_IDS],
} as const satisfies CompareViewSettings;

const RETURN_METRIC_IDS = new Set<CompareMetricId>(['return1m', 'return3m', 'return1y']);
const RETURN_WINDOW_TO_METRIC_ID: Record<Exclude<CompareReturnWindow, 'all'>, CompareMetricId> = {
  '1m': 'return1m',
  '3m': 'return3m',
  '1y': 'return1y',
};
const SYMBOL_PATTERN = /^[A-Z0-9]{1,5}\.(US|HK|SG|SH|SZ|HAS)$/;
const MAX_SAVED_VIEWS = 12;

export type SavedCompareViewSettings = CompareViewSettings;

export interface SavedCompareView {
  schemaVersion: typeof COMPARE_VIEW_SCHEMA_VERSION;
  id: string;
  name: string;
  symbols: string[];
  settings: SavedCompareViewSettings;
  createdAt: number;
  updatedAt: number;
}

interface SavedCompareViewsDocument {
  schemaVersion: typeof COMPARE_VIEW_SCHEMA_VERSION;
  views: SavedCompareView[];
}

export function visibleMetricIdsFor(
  preset: CompareMetricPreset,
  returnWindow: CompareReturnWindow
): CompareMetricId[] {
  const returnMetricId = returnWindow === 'all' ? undefined : RETURN_WINDOW_TO_METRIC_ID[returnWindow];
  return COMPARE_METRIC_DEFINITIONS.filter((definition) => {
    if (preset !== 'all' && definition.preset !== preset) return false;
    if (returnMetricId && RETURN_METRIC_IDS.has(definition.id)) {
      return definition.id === returnMetricId;
    }
    return true;
  }).map((definition) => definition.id);
}

export function updateCompareViewSettings(
  current: CompareViewSettings,
  patch: Partial<CompareViewSettings>
): CompareViewSettings {
  const next = { ...current, ...patch };
  if (patch.metricPreset !== undefined || patch.returnWindow !== undefined) {
    next.visibleMetricIds = visibleMetricIdsFor(next.metricPreset, next.returnWindow);
  }
  return next;
}

export function metricDefinitionForRow(rowMetric: string): CompareMetricDefinition | undefined {
  return COMPARE_METRIC_DEFINITIONS.find((definition) => definition.rowMetric === rowMetric);
}

export function savedCompareViewMatches(
  view: SavedCompareView,
  symbols: readonly string[],
  settings: CompareViewSettings
): boolean {
  return (
    sameStringArray(view.symbols, symbols)
    && view.settings.metricPreset === settings.metricPreset
    && view.settings.returnWindow === settings.returnWindow
    && view.settings.density === settings.density
    && sameStringArray(view.settings.visibleMetricIds, settings.visibleMetricIds)
  );
}

export function createSavedCompareView(input: {
  id?: string;
  name: string;
  symbols: string[];
  settings: CompareViewSettings;
  createdAt?: number;
  now?: number;
}): SavedCompareView {
  const now = input.now ?? Date.now();
  const symbols = normalizeSavedSymbols(input.symbols);
  const name = input.name.trim().slice(0, 80) || symbols.join(' / ');
  const visibleMetricIds = input.settings.visibleMetricIds.length > 0
    ? [...input.settings.visibleMetricIds]
    : visibleMetricIdsFor(input.settings.metricPreset, input.settings.returnWindow);
  return {
    schemaVersion: COMPARE_VIEW_SCHEMA_VERSION,
    id: input.id ?? createCompareViewId(now),
    name,
    symbols,
    settings: {
      ...input.settings,
      visibleMetricIds,
    },
    createdAt: input.createdAt ?? now,
    updatedAt: now,
  };
}

export function upsertSavedCompareView(
  views: SavedCompareView[],
  view: SavedCompareView
): SavedCompareView[] {
  const existingIndex = views.findIndex((candidate) => candidate.id === view.id);
  if (existingIndex >= 0) {
    return views.map((candidate) => (candidate.id === view.id ? view : candidate));
  }
  return [view, ...views].slice(0, MAX_SAVED_VIEWS);
}

export function removeSavedCompareView(
  views: SavedCompareView[],
  id: string
): SavedCompareView[] {
  return views.filter((view) => view.id !== id);
}

export function loadSavedCompareViews(): SavedCompareView[] {
  return parseSavedCompareViews(readPersisted<unknown>(SAVED_COMPARE_VIEWS_STORAGE_KEY, null));
}

export function persistSavedCompareViews(views: SavedCompareView[]): void {
  const document: SavedCompareViewsDocument = {
    schemaVersion: COMPARE_VIEW_SCHEMA_VERSION,
    views,
  };
  writePersisted(SAVED_COMPARE_VIEWS_STORAGE_KEY, document);
}

export function readLastSavedCompareViewId(): string | null {
  const value = readPersisted<unknown>(LAST_SAVED_COMPARE_VIEW_STORAGE_KEY, null);
  return typeof value === 'string' ? value : null;
}

export function writeLastSavedCompareViewId(id: string | null): void {
  writePersisted(LAST_SAVED_COMPARE_VIEW_STORAGE_KEY, id);
}

export function parseSavedCompareViews(value: unknown): SavedCompareView[] {
  if (!isRecord(value) || value.schemaVersion !== COMPARE_VIEW_SCHEMA_VERSION || !Array.isArray(value.views)) {
    return [];
  }
  return value.views.filter(isSavedCompareView);
}

function isSavedCompareView(value: unknown): value is SavedCompareView {
  if (!isRecord(value) || value.schemaVersion !== COMPARE_VIEW_SCHEMA_VERSION) return false;
  if (typeof value.id !== 'string' || value.id.trim() === '') return false;
  if (typeof value.name !== 'string' || value.name.trim() === '') return false;
  if (!Array.isArray(value.symbols)) return false;
  if (normalizeSavedSymbols(value.symbols).length !== value.symbols.length) return false;
  if (typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt)) return false;
  if (typeof value.updatedAt !== 'number' || !Number.isFinite(value.updatedAt)) return false;
  if (!isRecord(value.settings)) return false;
  if (!isMetricPreset(value.settings.metricPreset)) return false;
  if (!isReturnWindow(value.settings.returnWindow)) return false;
  if (value.settings.density !== 'comfortable' && value.settings.density !== 'compact') return false;
  if (!Array.isArray(value.settings.visibleMetricIds)) return false;
  if (!value.settings.visibleMetricIds.every(isCompareMetricId)) return false;
  return true;
}

function normalizeSavedSymbols(symbols: readonly unknown[]): string[] {
  const normalized: string[] = [];
  for (const symbol of symbols) {
    if (typeof symbol !== 'string') continue;
    const candidate = symbol.trim().toUpperCase();
    if (!SYMBOL_PATTERN.test(candidate) || normalized.includes(candidate)) continue;
    normalized.push(candidate);
  }
  return normalized.length >= 2 && normalized.length <= 4 ? normalized : [];
}

function isCompareMetricId(value: unknown): value is CompareMetricId {
  return typeof value === 'string' && (COMPARE_METRIC_IDS as readonly string[]).includes(value);
}

function isMetricPreset(value: unknown): value is CompareMetricPreset {
  return value === 'all' || value === 'priceReturns' || value === 'valuation' || value === 'fundamentals';
}

function isReturnWindow(value: unknown): value is CompareReturnWindow {
  return value === 'all' || value === '1m' || value === '3m' || value === '1y';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function createCompareViewId(now: number): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID === 'function') return randomUUID.call(globalThis.crypto);
  return `compare-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
