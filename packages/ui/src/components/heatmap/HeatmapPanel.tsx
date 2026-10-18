import React, { useEffect, useMemo, useRef, useState } from 'react';
import { hierarchy, treemap, treemapSquarify } from 'd3-hierarchy';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Table2, LayoutGrid } from 'lucide-react';
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
const legend = [
  { value: -3, label: '≤ -3%' },
  { value: -2, label: '(-3%, -1%)' },
  { value: -0.5, label: '[-1%, 0%)' },
  { value: 0, label: '0%' },
  { value: 0.5, label: '(0%, 1%)' },
  { value: 2, label: '[1%, 3%)' },
  { value: 3, label: '≥ 3%' },
];

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
  const layout = treemap<HeatmapNode>().tile(treemapSquarify).size([width, height]).paddingInner(2)
    .paddingTop((node) => node.depth === 1 ? 18 : 2)(root);
  return {
    groups: (layout.children ?? []).map((group) => ({
      key: group.data.key ?? '',
      label: group.children?.[0]?.data.tile?.industry?.name ?? '',
      x: group.x0, y: group.y0, width: group.x1 - group.x0,
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
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] font-semibold">{t('heatmap.title')}</span>
          <div className="flex flex-wrap items-center gap-2 text-[10px] text-foreground/68" aria-label={t('heatmap.legend')}>
            {legend.map(({ value, label }) => (
              <span key={value} className="flex items-center gap-1" aria-label={label}>
                <span aria-hidden="true" className="h-2.5 w-2.5" style={{ backgroundColor: heatmapColor({ state: 'current', changePercent: value }) }} />
                <span>{label}</span>
              </span>
            ))}
            <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 bg-gray-500" />{t('heatmap.unknown')} / {t('heatmap.stale')}</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <label className="text-[11px] text-foreground/58" htmlFor="heatmap-weight">{t('heatmap.size')}</label>
          <select id="heatmap-weight" value={effectiveMode} onChange={(event) => setDisplayMode(event.target.value as DisplayMode)} className="h-7 rounded border border-border bg-surface px-2 text-[11px]" disabled={source.kind !== 'portfolio' || !snapshot?.weightedAvailable}>
            <option value="equal">{t('heatmap.equal')}</option>
            <option value="weight">{t('heatmap.weighted')}</option>
          </select>
          <Button variant="ghost" size="icon" title={t('heatmap.map')} aria-label={t('heatmap.map')} aria-pressed={viewMode === 'map'} onClick={() => setViewMode('map')}><LayoutGrid className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" title={t('heatmap.table')} aria-label={t('heatmap.table')} aria-pressed={viewMode === 'table'} onClick={() => setViewMode('table')}><Table2 className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" title={t('heatmap.refresh')} aria-label={t('heatmap.refresh')} onClick={() => setRefresh((value) => value + 1)} disabled={busy}><RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} /></Button>
        </div>
      </div>
      {busy && !snapshot && <p role="status" className="py-8 text-center text-[12px] text-foreground/54">{t('heatmap.loading')}</p>}
      {error && <p role="alert" className="py-4 text-[12px] text-[var(--mac-red)]">{error}</p>}
      {snapshot && snapshot.tiles.length === 0 && <p className="py-8 text-center text-[12px] text-foreground/52">{t('heatmap.empty')}</p>}
      {snapshot && snapshot.tiles.length > 0 && (
        <>
          {viewMode === 'map' ? (
            <div ref={mapRef} className="relative h-[360px] w-full min-w-0 overflow-hidden bg-background" role="group" aria-label={t('heatmap.title')}>
              {layout.groups.map((group) => <span key={group.key} aria-hidden="true" className="pointer-events-none absolute z-10 truncate px-1 text-[9px] font-medium text-foreground/72" style={{ left: `${group.x / dimensions.width * 100}%`, top: `${group.y / dimensions.height * 100}%`, width: `${group.width / dimensions.width * 100}%` }}>{group.label || t('heatmap.unknownIndustry')}</span>)}
              {layout.tiles.map(({ tile, x, y, width, height }) => (
                <button
                  key={tile.instrument.instrumentId}
                  type="button"
                  onClick={() => openResearch(tile)}
                  title={[
                    tile.instrument.name, tile.workspaceSymbol, moveLabel(tile),
                    tile.industry?.name ?? t('heatmap.unknownIndustry'),
                    tile.instrument.market, tile.instrument.currency,
                    tile.weight === null ? '' : formatPercentRatio(tile.weight),
                    tile.provenance?.providerName ?? t('heatmap.unknown'),
                    formatDateTime(tile.provenance?.marketTime),
                    tile.provenance?.delayed ? t('heatmap.delayed') : '',
                  ].filter(Boolean).join(' · ')}
                  aria-label={`${tile.instrument.name}, ${tile.workspaceSymbol}, ${moveLabel(tile)}. ${t('heatmap.openResearch')}`}
                  aria-pressed={selected?.instrument.instrumentId === tile.instrument.instrumentId}
                  data-testid={`heatmap-tile-${tile.instrument.symbol}`}
                  className={`absolute flex min-h-0 flex-col items-start justify-center overflow-hidden border-2 p-1.5 text-left text-white focus:z-10 focus:outline focus:outline-2 focus:outline-white ${selected?.instrument.instrumentId === tile.instrument.instrumentId ? 'border-white' : 'border-white/35'}`}
                  style={{ left: `${x / dimensions.width * 100}%`, top: `${y / dimensions.height * 100}%`, width: `${width / dimensions.width * 100}%`, height: `${height / dimensions.height * 100}%`, backgroundColor: heatmapColor(tile), minWidth: 0 }}
                >
                  <span className="max-w-full truncate text-[12px] font-semibold">{tile.instrument.symbol}</span>
                  <span className="max-w-full truncate text-[10px]">{moveLabel(tile)}</span>
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
