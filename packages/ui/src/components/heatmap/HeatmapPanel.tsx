import React, { useEffect, useMemo, useRef, useState } from 'react';
import { hierarchy, treemap, treemapSquarify } from 'd3-hierarchy';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Table2, LayoutGrid, Check } from 'lucide-react';
import { formatDateTime, formatPercent, formatPercentRatio } from '@finagent/i18n';
import type { HeatmapSnapshot, HeatmapSourceSnapshot, HeatmapTile } from '@finagent/core';
import { heatmapColor } from '@finagent/core';
import { useAtomValue } from 'jotai';
import { activeSymbolAtom } from '../../atoms';
import { useFinagentClient } from '../../client';
import { Button } from '../primitives/Button';

type DisplayMode = 'equal' | 'weight';
type ViewMode = 'map' | 'table';
type HeatmapNode = { key?: string; children?: HeatmapNode[]; tile?: HeatmapTile; value?: number };
let requestSequence = 0;
export const HEATMAP_TEXT_THRESHOLDS = { medium: 34, large: 72 } as const;

export function heatmapTileTextScale(width: number, height: number): 'large' | 'medium' | 'small' | 'hidden' {
  const size = Math.min(width, height);
  if (size >= HEATMAP_TEXT_THRESHOLDS.large) return 'large';
  if (size >= HEATMAP_TEXT_THRESHOLDS.medium) return 'medium';
  if (size >= 18) return 'small';
  return 'hidden';
}

const HEATMAP_GROUP_HEADER_HEIGHT = 24;

export function heatmapRectangles(snapshot: HeatmapSnapshot, mode: DisplayMode, width: number, height: number) {
  const grouped = new Map<string, { tile: HeatmapTile; value: number }[]>();
  for (const tile of snapshot.tiles) {
    if (tile.exclusion === 'short' || tile.exclusion === 'zero') continue;
    const industry = tile.industry
      ? `${tile.industry.classification}:${tile.industry.code ?? tile.industry.name}`
      : 'unknown';
    const group = grouped.get(industry) ?? [];
    group.push({ tile, value: mode === 'weight' ? tile.weight ?? 0 : 1 });
    grouped.set(industry, group);
  }
  const data = [...grouped.entries()].map(([key, values]) => ({
    key,
    children: values.map(({ tile, value }) => ({ key: tile.instrument.instrumentId, tile, value })),
  }));
  const root = hierarchy<HeatmapNode>({ children: data })
    .sum((node) => (typeof node.value === 'number' ? node.value : 0))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const layout = treemap<HeatmapNode>().tile(treemapSquarify).size([width, height])
    .paddingInner((node) => node.depth === 0 ? 4 : 1)
    .paddingTop((node) => node.depth === 1 ? HEATMAP_GROUP_HEADER_HEIGHT : 1)(root);
  return {
    groups: (layout.children ?? []).map((group) => ({
      key: group.data.key ?? '',
      label: group.children?.[0]?.data.tile?.industry?.name ?? '',
      classification: group.children?.[0]?.data.tile?.industry?.classification,
      code: group.children?.[0]?.data.tile?.industry?.code,
      count: group.leaves().length,
      x: group.x0, y: group.y0, width: group.x1 - group.x0, height: group.y1 - group.y0,
    })),
    tiles: layout.leaves().filter((leaf) => leaf.data.tile).map((leaf) => ({
      tile: leaf.data.tile!,
      x: leaf.x0,
      y: leaf.y0,
      width: leaf.x1 - leaf.x0,
      height: leaf.y1 - leaf.y0,
    })),
  };
}

export function HeatmapPanel({
  source,
  onSelect,
  onResearch,
}: {
  source: HeatmapSourceSnapshot;
  onSelect?: (tile: HeatmapTile) => void;
  onResearch: (tile: HeatmapTile) => void;
}) {
  const { t } = useTranslation('portfolio');
  const client = useFinagentClient();
  const activeSymbol = useAtomValue(activeSymbolAtom);
  const [loadedSnapshot, setSnapshot] = useState<HeatmapSnapshot | null>(null);
  const snapshot = loadedSnapshot?.source.id === source.id && loadedSnapshot.source.revision === source.revision
    ? loadedSnapshot : null;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [displayMode, setDisplayMode] = useState<DisplayMode>('equal');
  const [viewMode, setViewMode] = useState<ViewMode>('map');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const activeSymbolRef = useRef(activeSymbol);
  activeSymbolRef.current = activeSymbol;
  const [dimensions, setDimensions] = useState({ width: 960, height: 360 });
  const mapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const load = client.market.getHeatmap;
    const requestId = `heatmap-${Date.now()}-${++requestSequence}`;
    let active = true;
    setBusy(true);
    setError(null);
    if (!load) {
      setBusy(false);
      setError(t('heatmap.unavailable'));
      return () => { active = false; };
    }
    void load({ requestId, source }).then((result) => {
      if (!active) return;
      if (!result.ok) {
        setSnapshot(null);
        setError(result.error.message);
        return;
      }
      if (result.data.source.id !== source.id || result.data.source.revision !== source.revision) {
        setSnapshot(null);
        setError(t('heatmap.snapshotMismatch'));
        return;
      }
      setSnapshot(result.data);
      setSelectedId((current) => result.data.tiles.some((tile) => tile.instrument.instrumentId === current)
        ? current
        : result.data.tiles.find((tile) => tile.workspaceSymbol === activeSymbolRef.current)?.instrument.instrumentId ?? null);
    }).catch((cause: unknown) => {
      if (active) {
        setSnapshot(null);
        setError(cause instanceof Error ? cause.message : t('heatmap.unavailable'));
      }
    }).finally(() => { if (active) setBusy(false); });
    return () => {
      active = false;
      void client.market.cancelHeatmap?.(requestId);
    };
  }, [client, source.id, source.revision, refresh, t]);

  useEffect(() => {
    const element = mapRef.current;
    if (!element) return;
    const measure = () => setDimensions({
      width: Math.max(element.clientWidth, 320),
      height: Math.max(element.clientHeight, 280),
    });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [snapshot, viewMode]);

  const selected = snapshot?.tiles.find((tile) => tile.workspaceSymbol === activeSymbol)
    ?? snapshot?.tiles.find((tile) => tile.instrument.instrumentId === selectedId)
    ?? null;
  const effectiveMode = snapshot?.weightedAvailable ? displayMode : 'equal';
  const layout = useMemo(() => snapshot ? heatmapRectangles(snapshot, effectiveMode, dimensions.width, dimensions.height) : { groups: [], tiles: [] }, [snapshot, effectiveMode, dimensions]);
  const unmapped = snapshot?.tiles.filter((tile) => tile.exclusion !== undefined) ?? [];
  const select = (tile: HeatmapTile) => {
    setSelectedId(tile.instrument.instrumentId);
    onSelect?.(tile);
  };
  const openResearch = (tile: HeatmapTile) => {
    select(tile);
    onResearch(tile);
  };
  const moveLabel = (tile: HeatmapTile) => tile.changePercent === null
    ? t('heatmap.unknown')
    : `${formatPercent(tile.changePercent)}${tile.state !== 'current' ? ` · ${t(`heatmap.${tile.state}`)}` : ''}`;

  return (
    <section className="space-y-3 border-y border-border py-3" data-testid="heatmap-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[14px] font-semibold leading-5">{t('heatmap.title')}</h3>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-foreground/68" aria-label={t('heatmap.legend')}>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-28 rounded-sm" style={{ background: 'linear-gradient(90deg, #F23645 0%, #343a40 50%, #089981 100%)' }} aria-hidden="true" /><span>-3%</span><span>0%</span><span>+3%</span></span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#6b7280]" />{t('heatmap.stale')}</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#4b5563]" />{t('heatmap.unknown')}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div role="group" aria-label={t('heatmap.size')} className="heatmap-size-control flex h-8 items-center rounded border border-border bg-foreground/[0.035] p-0.5">
            {(['equal', 'weight'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={effectiveMode === mode}
                disabled={mode === 'weight' && (source.kind !== 'portfolio' || !snapshot?.weightedAvailable)}
                onClick={() => setDisplayMode(mode)}
                className="flex h-full items-center gap-1.5 rounded-sm px-2.5 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              >
                {effectiveMode === mode && <Check aria-hidden="true" className="h-3 w-3 text-accent" />}
                <span className="text-foreground/80">{t(mode === 'weight' ? 'heatmap.weighted' : 'heatmap.equal')}</span>
              </button>
            ))}
          </div>
          <span className="mx-0.5 h-5 w-px bg-border" aria-hidden="true" />
          <Button variant="ghost" size="icon" style={viewMode === 'map' ? { backgroundColor: 'var(--surface-hover)' } : undefined} title={t('heatmap.map')} aria-label={t('heatmap.map')} aria-pressed={viewMode === 'map'} onClick={() => setViewMode('map')}><LayoutGrid className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" style={viewMode === 'table' ? { backgroundColor: 'var(--surface-hover)' } : undefined} title={t('heatmap.table')} aria-label={t('heatmap.table')} aria-pressed={viewMode === 'table'} onClick={() => setViewMode('table')}><Table2 className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" title={t('heatmap.refresh')} aria-label={t('heatmap.refresh')} onClick={() => setRefresh((value) => value + 1)} disabled={busy}><RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} /></Button>
        </div>
      </div>
      {busy && !snapshot && <p role="status" className="py-8 text-center text-[12px] text-foreground/54">{t('heatmap.loading')}</p>}
      {error && <p role="alert" className="py-4 text-[12px] text-[var(--mac-red)]">{error}</p>}
      {snapshot && snapshot.tiles.length === 0 && <p className="py-8 text-center text-[12px] text-foreground/52">{t('heatmap.empty')}</p>}
      {snapshot && snapshot.tiles.length > 0 && (
        <>
          {viewMode === 'map' ? (
            <div ref={mapRef} className="relative h-[340px] w-full min-w-0 overflow-hidden border border-border bg-[#11161c] sm:h-[420px]" role="group" aria-label={t('heatmap.title')}>
              {layout.groups.map((group) => (
                <div
                  key={group.key}
                  aria-hidden="true"
                  className="pointer-events-none absolute z-10 flex items-center justify-between gap-2 overflow-hidden bg-[#1b222b] px-2 text-white/85"
                  style={{ left: `${group.x / dimensions.width * 100}%`, top: `${group.y / dimensions.height * 100}%`, width: `${group.width / dimensions.width * 100}%`, height: `${HEATMAP_GROUP_HEADER_HEIGHT}px` }}
                >
                  {group.width >= 72 && group.height >= HEATMAP_GROUP_HEADER_HEIGHT && <><span className="min-w-0 truncate text-[11px] font-bold leading-none">{group.label || t('heatmap.unknownIndustry')}</span><span className="shrink-0 text-[10px] text-white/55">{group.width >= 150 ? t('heatmap.instrumentsCount', { count: group.count }) : group.count}</span></>}
                </div>
              ))}
              {layout.tiles.map(({ tile, x, y, width, height }) => (
                <button
                  key={tile.instrument.instrumentId}
                  type="button"
                  onClick={() => openResearch(tile)}
                  aria-label={`${tile.instrument.name}, ${tile.workspaceSymbol}, ${moveLabel(tile)}. ${t('heatmap.openResearch')}`}
                  aria-pressed={selected?.instrument.instrumentId === tile.instrument.instrumentId}
                  data-testid={`heatmap-tile-${tile.instrument.symbol}`}
                  className={`group absolute flex min-h-0 flex-col items-center justify-center overflow-visible rounded-[1px] text-center text-white transition-[filter] duration-100 hover:z-30 hover:brightness-125 focus-visible:z-20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white ${selected?.instrument.instrumentId === tile.instrument.instrumentId ? 'z-10 outline outline-2 outline-white' : ''}`}
                  style={{ left: `${x / dimensions.width * 100}%`, top: `${y / dimensions.height * 100}%`, width: `${width / dimensions.width * 100}%`, height: `${height / dimensions.height * 100}%`, backgroundColor: heatmapColor(tile), minWidth: 0 }}
                >
                  {(['large', 'medium'].includes(heatmapTileTextScale(width, height))) && <span className="max-w-full truncate px-1 font-bold leading-tight" style={{ fontSize: `${Math.max(10, Math.min(28, Math.round(Math.min(width, height) * 0.22)))}px` }}>{tile.instrument.symbol}</span>}
                  {heatmapTileTextScale(width, height) === 'large' && <span className="max-w-full truncate px-1 text-[11px] font-medium leading-tight">{moveLabel(tile)}</span>}
                  {(tile.state !== 'current' || tile.provenance?.delayed) && <span className="absolute right-1 top-1 rounded bg-black/25 px-1 text-[8px] font-bold uppercase leading-3 text-white/80" aria-label={tile.provenance?.delayed ? t('heatmap.delayed') : t(`heatmap.${tile.state}`)}>{tile.provenance?.delayed ? 'D' : 'S'}</span>}
                  <span className={`pointer-events-none absolute z-50 w-56 rounded-md border border-white/15 bg-[#11161c]/95 p-2 text-left text-[10px] leading-4 text-white shadow-xl ${y < 90 ? 'top-full mt-1' : 'bottom-full mb-1'} ${x < 110 ? 'left-0' : x + width > dimensions.width - 110 ? 'right-0' : 'left-1/2 -translate-x-1/2'} hidden group-hover:block group-focus-visible:block`}>
                    <strong className="block truncate text-[11px]">{tile.instrument.name} · {tile.workspaceSymbol}</strong>
                    <span className="block">{t('heatmap.change')}: {moveLabel(tile)} · {t('heatmap.industry')}: {tile.industry?.name ?? t('heatmap.unknownIndustry')}</span>
                    <span className="block">{t('heatmap.weight')}: {tile.weight === null ? '—' : formatPercentRatio(tile.weight)} · {t('heatmap.source')}: {tile.provenance?.providerName ?? t('heatmap.unknown')}</span>
                    <span className="block">{t('heatmap.asOf')}: {formatDateTime(tile.provenance?.marketTime)}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]" data-testid="heatmap-table">
                <thead className="text-foreground/54"><tr><th className="py-2">{t('heatmap.instrument')}</th><th>{t('heatmap.industry')}</th><th>{t('heatmap.change')}</th><th>{t('heatmap.weight')}</th><th>{t('heatmap.source')}</th><th>{t('heatmap.status')}</th><th /></tr></thead>
                <tbody className="divide-y divide-border">{snapshot.tiles.map((tile) => <tr key={tile.instrument.instrumentId} className="hover:bg-foreground/[0.03]">
                  <td className="py-2 pr-2"><button type="button" aria-pressed={selected?.instrument.instrumentId === tile.instrument.instrumentId} className="text-left focus-visible:underline" onClick={() => select(tile)}>{tile.instrument.name}<span className="ml-2 text-foreground/54">{tile.workspaceSymbol}</span></button></td>
                  <td>{tile.industry?.name ?? t('heatmap.unknownIndustry')}</td>
                  <td><span className="mr-1 inline-block h-2.5 w-2.5" style={{ backgroundColor: heatmapColor(tile) }} />{moveLabel(tile)}</td>
                  <td>{tile.weight === null ? '—' : formatPercentRatio(tile.weight)}</td>
                  <td>{tile.provenance?.providerName ?? '—'}</td>
                  <td>{tile.session ?? '—'} · {formatDateTime(tile.provenance?.marketTime)}{tile.provenance?.delayed ? ` · ${t('heatmap.delayed')}` : ''}</td>
                  <td><button type="button" onClick={() => openResearch(tile)} className="whitespace-nowrap text-[var(--mac-blue)] focus-visible:underline">{t('heatmap.openResearch')}</button></td>
                </tr>)}</tbody>
              </table>
            </div>
          )}
          {snapshot.weightedAvailable && effectiveMode === 'weight' && <p className="text-[10px] text-foreground/48">{t('heatmap.baseCurrency', { currency: source.baseCurrency })}</p>}
          {unmapped.map((tile) => <p key={tile.instrument.instrumentId} className="text-[10px] text-foreground/58">{tile.workspaceSymbol} · {t(`heatmap.exclusions.${tile.exclusion}`)}</p>)}
          {selected && <aside className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-border pt-2 text-[10px]" aria-live="polite" data-testid="heatmap-detail">
            <span className="col-span-2 text-[11px] font-semibold">{selected.instrument.name} · {selected.workspaceSymbol}</span>
            <span>{t('heatmap.market')}: {selected.instrument.market}</span><span>{t('heatmap.industry')}: {selected.industry?.name ?? t('heatmap.unknownIndustry')}</span>
            <span>{t('heatmap.change')}: {moveLabel(selected)}</span><span>{t('heatmap.weight')}: {selected.weight === null ? '—' : formatPercentRatio(selected.weight)}</span>
            <span>{t('heatmap.currency')}: {selected.instrument.currency}</span><span>{t('heatmap.source')}: {selected.provenance?.providerName ?? '—'}</span>
            <span>{t('heatmap.asOf')}: {formatDateTime(selected.provenance?.marketTime)}</span><span>{t('heatmap.status')}: {selected.session ?? '—'}{selected.provenance?.delayed ? ` · ${t('heatmap.delayed')}` : ''}{selected.provenance?.stale ? ` · ${t('heatmap.stale')}` : ''}</span>
            <button type="button" className="col-span-2 justify-self-start text-[var(--mac-blue)] focus-visible:underline" onClick={() => openResearch(selected)}>{t('heatmap.openResearch')}</button>
          </aside>}
        </>
      )}
      {snapshot?.unresolved.map((item) => <p key={item.symbol} className="text-[10px] text-foreground/58">{item.symbol} · {t('heatmap.unresolved')}</p>)}
    </section>
  );
}
