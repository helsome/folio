import type {
  HeatmapCell,
  HeatmapEntry,
  HeatmapInput,
  HeatmapSnapshot,
  HeatmapWeightIssue,
} from '@finagent/core';
import { marketSourceOf } from '../providers/market-source.ts';

const code = (value: string): string => value.trim().toUpperCase();
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function quoteFields(entry: HeatmapEntry): Pick<
  HeatmapCell, 'changePercent' | 'quoteStatus' | 'quoteTimestamp' | 'source' | 'provenance' | 'errorCode'
> {
  const result = entry.quote;
  if (!result) return { changePercent: null, quoteStatus: 'missing' };
  if (!result.ok) return { changePercent: null, quoteStatus: 'error', errorCode: result.error.code };

  const { data, provenance } = result;
  const identities = [data.instrumentId, provenance.instrumentId].filter(
    (id): id is string => typeof id === 'string' && id.trim().length > 0
  );
  // Provider tickers cannot distinguish canonical listings reliably.
  if (identities.length === 0) return { changePercent: null, quoteStatus: 'identity-unknown' };
  if (identities.some((id) => code(id) !== code(entry.instrument.instrumentId))) {
    return { changePercent: null, quoteStatus: 'identity-mismatch' };
  }

  return {
    changePercent: finite(data.changePercent) ? data.changePercent : null,
    quoteStatus: !finite(data.changePercent) ? 'missing'
      : provenance.stale ? 'stale' : provenance.delayed ? 'delayed' : 'available',
    ...(finite(data.timestamp) ? { quoteTimestamp: data.timestamp } : {}),
    source: marketSourceOf(provenance),
    provenance: {
      ...provenance,
      ...(provenance.failoverTrail ? {
        failoverTrail: provenance.failoverTrail.map((step) => ({ ...step })),
      } : {}),
    },
  };
}

function lotValue(entry: HeatmapEntry, baseCurrency: string | undefined): {
  value: number;
  issues: HeatmapWeightIssue[];
} {
  const holding = entry.holding;
  const issues: HeatmapWeightIssue[] = [];
  if (!baseCurrency) issues.push('missing-base-currency');
  if (holding && [holding.quantity, holding.marketValue, holding.marketValueBase].some(
    (value) => finite(value) && value < 0
  )) issues.push('unsupported-short');

  // marketValueBase is already converted by the existing account boundary.
  // Otherwise a native value is usable only in the explicit base currency.
  const value = finite(holding?.marketValueBase) ? holding.marketValueBase
    : baseCurrency && holding?.currency && code(holding.currency) === baseCurrency
      ? holding.marketValue : undefined;
  if (!finite(holding?.quantity) || !finite(value)) issues.push('missing-valuation');
  return { value: finite(value) ? value : 0, issues };
}

/**
 * Pure projection: no fetch, cache, clock, FX conversion or demo fallback.
 * Pass the same frozen snapshot and gateway results used by the list view.
 * A partial portfolio must not masquerade as a complete 100% allocation, so
 * one unsupported/missing lot disables all portfolio area weights.
 */
export function buildHeatmapSnapshot(input: HeatmapInput): HeatmapSnapshot {
  if (!input.snapshotId.trim()) throw new Error('Heatmap snapshotId is required.');
  const baseCurrency = input.mode === 'portfolio' ? code(input.baseCurrency ?? '') || undefined : undefined;
  const cells = new Map<string, { cell: HeatmapCell; value: number }>();

  for (const entry of input.entries) {
    const id = code(entry.instrument.instrumentId);
    if (!id) throw new Error('Heatmap requires a canonical instrumentId.');
    let item = cells.get(id);
    if (!item) {
      item = {
        cell: {
          instrumentId: entry.instrument.instrumentId,
          symbol: entry.instrument.symbol,
          name: entry.instrument.name,
          market: entry.instrument.market,
          currency: entry.instrument.currency,
          sector: entry.sector?.trim() || null,
          ...quoteFields(entry),
          areaWeight: null,
          weightIssues: [],
        },
        value: 0,
      };
      cells.set(id, item);
    }
    if (input.mode === 'portfolio') {
      const lot = lotValue(entry, baseCurrency);
      item.value += lot.value;
      item.cell.weightIssues = [...new Set([...item.cell.weightIssues, ...lot.issues])];
    }
  }

  const items = [...cells.values()];
  const issues = new Set(items.flatMap(({ cell }) => cell.weightIssues));
  const total = items.reduce((sum, { value }) => sum + value, 0);
  if (input.mode === 'portfolio' && items.length > 0 && (!finite(total) || total <= 0)) {
    issues.add('invalid-total');
  }
  const weightsAvailable = items.length > 0 && issues.size === 0;
  const groups = new Map<string | null, HeatmapCell[]>();
  for (const { cell, value } of items) {
    cell.areaWeight = !weightsAvailable ? null
      : input.mode === 'watchlist' ? 1 / items.length : value / total;
    const group = groups.get(cell.sector) ?? [];
    group.push(cell);
    groups.set(cell.sector, group);
  }
  return {
    snapshotId: input.snapshotId,
    mode: input.mode,
    ...(baseCurrency ? { baseCurrency } : {}),
    weightsAvailable,
    weightIssues: [...issues],
    groups: [...groups].map(([sector, groupCells]) => ({ sector, cells: groupCells })),
  };
}
