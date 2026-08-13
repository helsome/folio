import React from 'react';
import type { Quote } from '@finagent/core';
import { MetricGrid } from './MetricGrid';

const fmtNum = (n: number | null | undefined, digits = 2): string =>
  n == null || Number.isNaN(n) ? '—' : n.toFixed(digits);

const fmtCompact = (n: number | null | undefined): string => {
  if (n == null || Number.isNaN(n)) return '—';
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return String(n);
};

const fmtTime = (ts: number | null | undefined): string =>
  ts == null || Number.isNaN(ts) ? '—' : new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const signed = (n: number): string => `${n >= 0 ? '+' : ''}${n.toFixed(2)}`;

interface QuoteCardProps {
  quote: Quote;
}

/** Renders a defensive, Quote-shaped object produced by a get_quote tool call. */
export const QuoteCard: React.FC<QuoteCardProps> = ({ quote }) => {
  const symbol = quote.symbol || '—';
  const change = quote.change ?? 0;
  const changePercent = quote.changePercent ?? 0;
  const isPositive = change >= 0;
  const tone = isPositive ? 'text-[var(--mac-green)]' : 'text-[var(--mac-red)]';

  return (
    <div className="mac-stock-tile rounded-[14px] p-3.5">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-foreground/40">Quote</div>
          <div className="mt-0.5 truncate text-[15px] font-semibold text-foreground">{symbol}</div>
        </div>
        <div className="text-right">
          <div className="text-[20px] font-semibold tracking-tight text-foreground">
            ${fmtNum(quote.lastPrice)}
          </div>
          <div className={`text-[12px] font-semibold ${tone}`}>
            {signed(change)} ({signed(changePercent)}%)
          </div>
        </div>
      </div>
      <div className="mt-3">
        <MetricGrid
          columns={3}
          items={[
            { label: 'Open', value: fmtNum(quote.open) },
            { label: 'High', value: fmtNum(quote.high) },
            { label: 'Low', value: fmtNum(quote.low) },
            { label: 'Prev close', value: fmtNum(quote.prevClose) },
            { label: 'Volume', value: fmtCompact(quote.volume) },
            { label: 'Updated', value: fmtTime(quote.timestamp) },
          ]}
        />
      </div>
    </div>
  );
};
