import { useEffect, useRef } from 'react';
import {
  dispose,
  init,
  type Chart,
  type DeepPartial,
  type KLineData,
  type Period,
  type Styles,
} from 'klinecharts';
import type { FinancialBar } from './klineAdapter';

interface FinancialKLineChartProps {
  bars: FinancialBar[];
  symbol?: string;
  period?: string;
  showMA?: boolean;
  showEMA?: boolean;
}

const CANDLE_PANE_ID = 'candle_pane';

// Resolves a theme custom property (e.g. --positive) to a concrete color
// string the canvas can consume. Custom properties are returned verbatim by
// `getComputedStyle`, which is fine here: the finance tokens are `oklch(...)`
// values, all natively supported as canvas fill/stroke styles.
function resolveColor(el: HTMLElement, varName: string, fallback: string): string {
  const value = window.getComputedStyle(el).getPropertyValue(varName).trim();
  return value || fallback;
}

function toKLineData(bar: FinancialBar): KLineData {
  return {
    timestamp: bar.timestamp * 1000,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    ...(bar.volume !== undefined ? { volume: bar.volume } : {}),
  };
}

function toPeriod(period?: string): Period {
  switch (period) {
    case '1m':
      return { type: 'minute', span: 1 };
    case '5m':
      return { type: 'minute', span: 5 };
    case '15m':
      return { type: 'minute', span: 15 };
    case '1h':
      return { type: 'hour', span: 1 };
    case '1w':
      return { type: 'week', span: 1 };
    case '1d':
    default:
      return { type: 'day', span: 1 };
  }
}

/**
 * The only component in the tree that touches klinecharts. It owns the chart
 * lifecycle (init/dispose), the data loader, indicator toggles and resize
 * handling, exposing a narrow, render-agnostic `FinancialBar[]` interface.
 */
export function FinancialKLineChart({
  bars,
  symbol,
  period,
  showMA = false,
  showEMA = false,
}: FinancialKLineChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const barsRef = useRef<FinancialBar[]>(bars);
  const maIdRef = useRef<string | null>(null);
  const emaIdRef = useRef<string | null>(null);

  const hasData = bars.length > 0;

  // Initialize (or tear down) the chart whenever we enter/leave "has data".
  useEffect(() => {
    if (!hasData) return;
    const el = containerRef.current;
    if (!el) return;

    const upColor = resolveColor(el, '--positive', '#30d158');
    const downColor = resolveColor(el, '--negative', '#ff453a');
    const mutedColor = resolveColor(el, '--text-muted', '#94a3b8');

    const styles: DeepPartial<Styles> = {
      grid: {
        horizontal: { color: 'rgba(148, 163, 184, 0.12)' },
        vertical: { color: 'rgba(148, 163, 184, 0.12)' },
      },
      candle: {
        bar: {
          upColor,
          downColor,
          noChangeColor: upColor,
          upBorderColor: upColor,
          downBorderColor: downColor,
          noChangeBorderColor: upColor,
          upWickColor: upColor,
          downWickColor: downColor,
          noChangeWickColor: upColor,
        },
      },
      xAxis: { tickText: { color: mutedColor } },
      yAxis: { tickText: { color: mutedColor } },
    };

    const chart = init(el, { styles });
    if (!chart) return;
    chartRef.current = chart;

    chart.setDataLoader({
      getBars: (params) => {
        params.callback(barsRef.current.map(toKLineData), false);
      },
    });

    const resizeObserver = new ResizeObserver(() => chart.resize());
    resizeObserver.observe(el);

    return () => {
      resizeObserver.disconnect();
      dispose(el);
      chartRef.current = null;
      maIdRef.current = null;
      emaIdRef.current = null;
    };
  }, [hasData]);

  // Push the latest symbol / period / bars into the chart and re-trigger the
  // loader so the new data is rendered.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    barsRef.current = bars;
    chart.setSymbol({
      exchange: '',
      shortName: symbol ? symbol.split('.')[0] : '',
      ticker: symbol ?? '',
    });
    chart.setPeriod(toPeriod(period));
    chart.resetData();
  }, [symbol, period, bars]);

  // Toggle the built-in MA / EMA indicators in the candle pane.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (showMA && maIdRef.current === null) {
      maIdRef.current = chart.createIndicator({ name: 'MA', paneId: CANDLE_PANE_ID });
    } else if (!showMA && maIdRef.current !== null) {
      chart.removeIndicator({ id: maIdRef.current });
      maIdRef.current = null;
    }

    if (showEMA && emaIdRef.current === null) {
      emaIdRef.current = chart.createIndicator({ name: 'EMA', paneId: CANDLE_PANE_ID });
    } else if (!showEMA && emaIdRef.current !== null) {
      chart.removeIndicator({ id: emaIdRef.current });
      emaIdRef.current = null;
    }
  }, [showMA, showEMA, hasData]);

  if (!hasData) {
    return (
      <div className="flex h-full w-full items-center justify-center text-[12.5px] text-text-muted">
        No market data
      </div>
    );
  }

  return <div ref={containerRef} data-testid="chart-canvas" className="h-full w-full" />;
}
