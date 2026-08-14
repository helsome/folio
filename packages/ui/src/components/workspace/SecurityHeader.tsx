import React, { useEffect, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import type { Quote, StaticInfo, MarketStatus } from '@finagent/core';
import { activeSymbolAtom, navSectionAtom } from '../../atoms';
import { useFinagentClient } from '../../client';
import { DataFreshness } from '../primitives/DataFreshness';
const DASH = '\u2014';

const formatPrice = (value: number): string => `$${value.toFixed(2)}`;
const formatNumber = (value: number): string => value.toLocaleString();
const formatSigned = (value: number): string =>
  `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
const formatPercent = (value: number): string =>
  `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;

interface StatCellProps {
  label: string;
  value: string;
}

const StatCell: React.FC<StatCellProps> = ({ label, value }) => (
  <div className="min-w-[72px]">
    <div className="text-[10px] font-semibold uppercase tracking-wide text-foreground/42">
      {label}
    </div>
    <div className="mt-0.5 text-[13px] tabular-nums text-foreground">{value}</div>
  </div>
);

export const SecurityHeader: React.FC = () => {
  const client = useFinagentClient();
  const symbol = useAtomValue(activeSymbolAtom);
  const setNavSection = useSetAtom(navSectionAtom);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [info, setInfo] = useState<StaticInfo | null>(null);
  const [marketStatus, setMarketStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!symbol) {
      setQuote(null);
      setInfo(null);
      setMarketStatus(null);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setQuote(null);
    setInfo(null);
    setMarketStatus(null);

    const marketSuffix = symbol.split('.').pop()?.toUpperCase();

    const load = async () => {
      const quoteRes = await client.market.getQuote(symbol);
      if (cancelled) return;
      if (!quoteRes.ok) {
        setError(quoteRes.error.message);
        setLoading(false);
        return;
      }
      setQuote(quoteRes.data);

      client.market
        .getStaticInfo(symbol)
        .then((res) => {
          if (!cancelled && res.ok) setInfo(res.data);
        })
        .catch(() => {
          /* leave info null -> "—" */
        });

      client.market
        .getMarketStatus()
        .then((res) => {
          if (cancelled || !res.ok) return;
          const match = marketSuffix
            ? res.data.find(
                (s: MarketStatus) => s.market.toUpperCase() === marketSuffix
              )
            : undefined;
          setMarketStatus(match ? match.status : null);
        })
        .catch(() => {
          /* leave market status null -> "—" */
        });

      setLoading(false);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [client, symbol]);

  if (!symbol) return null;

  if (error) {
    return (
      <div className="border-b mac-section-divider px-4 py-3">
        <div
          className="text-[13px] font-bold uppercase text-foreground/72"
          data-testid="security-header-symbol"
        >
          {symbol}
        </div>
        <div className="mt-1 text-[12px] text-foreground/54">
          Quote unavailable: {error}
        </div>
      </div>
    );
  }

  if (loading || !quote) {
    return (
      <div className="border-b mac-section-divider px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="h-4 w-24 animate-pulse rounded bg-foreground/10" />
          <div className="h-4 w-12 animate-pulse rounded bg-foreground/8" />
        </div>
        <div className="mt-2 h-8 w-40 animate-pulse rounded bg-foreground/10" />
      </div>
    );
  }

  const isPositive = quote.change >= 0;
  const changeColor = isPositive ? 'var(--positive)' : 'var(--negative)';
  const name = info?.name ?? symbol;

  const stats: StatCellProps[] = [
    { label: 'Open', value: formatPrice(quote.open) },
    { label: 'High', value: formatPrice(quote.high) },
    { label: 'Low', value: formatPrice(quote.low) },
    { label: 'Prev Close', value: formatPrice(quote.prevClose) },
    { label: 'Volume', value: formatNumber(quote.volume) },
    { label: 'Turnover', value: DASH },
    { label: 'Market Status', value: marketStatus ?? DASH },
  ];

  return (
    <div className="border-b mac-section-divider px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold text-foreground">
            {name}
          </div>
          <div
            className="text-[11px] font-semibold uppercase tracking-wide text-foreground/48"
            data-testid="security-header-symbol"
          >
            {quote.symbol}
          </div>
        </div>

        <div className="flex flex-col items-end">
          <div
            className="text-[32px] font-semibold leading-none tracking-tight tabular-nums"
            style={{ color: changeColor }}
          >
            {formatPrice(quote.lastPrice)}
          </div>
          <div
            className="mt-1 text-[13px] tabular-nums"
            style={{ color: changeColor }}
          >
            {formatSigned(quote.change)} ({formatPercent(quote.changePercent)})
          </div>
          <DataFreshness
            providerName="Longbridge"
            updatedAtMs={quote.timestamp ? quote.timestamp * 1000 : undefined}
            className="mt-1.5"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setNavSection('research')}
            className="mac-primary-button rounded-[8px] px-3 py-1.5 text-[12px] font-semibold"
            data-testid="deep-research-button"
          >
            Deep Research
          </button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 border-t mac-section-divider pt-3">
        {stats.map((stat) => (
          <StatCell key={stat.label} label={stat.label} value={stat.value} />
        ))}
      </div>
    </div>
  );
};
