import React, { useMemo, useRef, useState } from 'react';
import type { TimeSeriesChartBlock } from '@finagent/core';
import { formatBlockValue, formatIsoAxisTick, formatIsoDate } from './blockFormat';
import { AnswerBlockFrame } from './AnswerBlockFrame';

const VIEW_W = 320;
const VIEW_H = 110;
const PAD_X = 4;
const PAD_TOP = 10;
const PAD_BOTTOM = 18;

/**
 * Deterministic SVG line chart for a `time_series_chart` block. No third-party
 * chart dependency, no model-controlled code: only validated numbers reach the
 * path. Hover shows the nearest point's value and date.
 */
export const TimeSeriesChartBlockView: React.FC<{ block: TimeSeriesChartBlock; streaming?: boolean }> = ({
  block,
  streaming,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const { path, area, min, max, yFor, xFor } = useMemo(() => computeGeometry(block.points), [block.points]);
  const first = block.points[0];
  const last = block.points[block.points.length - 1];
  const hover = hoverIndex !== null ? block.points[hoverIndex] : null;

  const handleMove = (event: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    const index = Math.round(ratio * (block.points.length - 1));
    setHoverIndex(Math.max(0, Math.min(block.points.length - 1, index)));
  };

  const unitLabel = block.currency ? `${block.unit} · ${block.currency}` : block.unit;

  return (
    <AnswerBlockFrame block={block} streaming={streaming}>
      <div className="flex items-baseline justify-between gap-2 text-[10.5px] text-foreground/48">
        <span>
          {formatIsoDate(first.t)} – {formatIsoDate(last.t)}
        </span>
        <span className="whitespace-nowrap uppercase tracking-wide">{unitLabel}</span>
      </div>
      <div className="relative mt-1" data-testid="answer-block-chart">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="block w-full"
          role="img"
          onMouseMove={handleMove}
          onMouseLeave={() => setHoverIndex(null)}
        >
          {[0, 0.5, 1].map((fraction) => {
            const y = PAD_TOP + fraction * (VIEW_H - PAD_TOP - PAD_BOTTOM);
            return (
              <line
                key={fraction}
                x1={PAD_X}
                x2={VIEW_W - PAD_X}
                y1={y}
                y2={y}
                style={{ stroke: 'rgba(var(--accent-rgb), 0.10)' }}
                strokeWidth={1}
              />
            );
          })}
          <path d={area} style={{ fill: 'rgba(var(--accent-rgb), 0.14)', stroke: 'none' }} />
          <path d={path} style={{ stroke: 'rgb(var(--accent-rgb))' }} strokeWidth={1.6} fill="none" strokeLinejoin="round" strokeLinecap="round" />
          {hoverIndex !== null && (
            <circle
              cx={xFor(hoverIndex)}
              cy={yFor(block.points[hoverIndex].v)}
              r={2.6}
              style={{ fill: 'rgb(var(--accent-rgb))' }}
            />
          )}
          <text x={PAD_X} y={PAD_TOP - 2} fontSize={8} fill="currentColor" opacity={0.45}>
            {formatBlockValue(max, block.unit, block.currency)}
          </text>
          <text x={PAD_X} y={VIEW_H - PAD_BOTTOM + 10} fontSize={8} fill="currentColor" opacity={0.45}>
            {formatBlockValue(min, block.unit, block.currency)}
          </text>
          <text x={VIEW_W - PAD_X} y={VIEW_H - 4} fontSize={8} textAnchor="end" fill="currentColor" opacity={0.45}>
            {formatIsoAxisTick(last.t)}
          </text>
          <text x={PAD_X} y={VIEW_H - 4} fontSize={8} fill="currentColor" opacity={0.45}>
            {formatIsoAxisTick(first.t)}
          </text>
        </svg>
        {hover && (
          <div className="pointer-events-none absolute right-1 top-1 rounded-[6px] border mac-section-divider bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-foreground shadow-sm">
            {formatBlockValue(hover.v, block.unit, block.currency)}
            <span className="ml-1 font-normal text-foreground/52">{formatIsoAxisTick(hover.t)}</span>
          </div>
        )}
      </div>
    </AnswerBlockFrame>
  );
};

function computeGeometry(points: TimeSeriesChartBlock['points']) {
  const values = points.map((point) => point.v);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || Math.abs(max) || 1;
  const innerH = VIEW_H - PAD_TOP - PAD_BOTTOM;
  const xFor = (index: number) =>
    PAD_X + (points.length === 1 ? 0 : (index / (points.length - 1)) * (VIEW_W - 2 * PAD_X));
  const yFor = (value: number) => PAD_TOP + (1 - (value - min) / span) * innerH;

  const coords = points.map((point, index) => [xFor(index), yFor(point.v)] as const);
  const path = coords.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const area = `${path} L${coords[coords.length - 1][0].toFixed(2)},${VIEW_H - PAD_BOTTOM} L${coords[0][0].toFixed(2)},${VIEW_H - PAD_BOTTOM} Z`;
  return { path, area, min, max, yFor, xFor };
}
