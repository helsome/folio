import React, { useEffect, useState } from 'react';
import { useAtomValue } from 'jotai';
import type {
  Quote,
  Kline,
  CalcIndex,
  StaticInfo,
  Portfolio,
  Position,
} from '@finagent/core';
import { activeSymbolAtom } from '../../atoms';
import { useFinagentClient } from '../../client';

const DASH = '\u2014';

const fmtPrice = (value: number): string => `$${value.toFixed(2)}`;
const fmtNumber = (value: number): string => value.toLocaleString();
const fmtPercent = (value: number): string => `${value.toFixed(2)}%`;
const fmtSigned = (value: number): string =>
  `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;

const signColor = (value: number): string =>
  value >= 0 ? 'var(--positive)' : 'var(--negative)';

interface BlockProps {
  title: string;
  children: React.ReactNode;
}

const Block: React.FC<BlockProps> = ({ title, children }) => (
  <section className="mac-stock-tile rounded-[12px] p-4">
    <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-foreground/48">
      {title}
    </h3>
    {children}
  </section>
);

interface MetricProps {
  label: string;
  value: string;
  color?: string;
  mono?: boolean;
}

const Metric: React.FC<MetricProps> = ({ label, value, color, mono = true }) => (
  <div className="flex items-center justify-between gap-3 py-1">
    <span className="text-[12px] text-foreground/54">{label}</span>
    <span
      className={`text-[13px] font-medium text-foreground ${mono ? 'tabular-nums' : ''}`}
      style={color ? { color } : undefined}
    >
      {value}
    </span>
  </div>
);

export const OverviewView: React.FC = () => {
  const client = useFinagentClient();
  const symbol = useAtomValue(activeSymbolAtom);

  const [quote, setQuote] = useState<Quote | null>(null);
  const [calcIndex, setCalcIndex] = useState<CalcIndex | null>(null);
  const [staticInfo, setStaticInfo] = useState<StaticInfo | null>(null);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [yearHigh, setYearHigh] = useState<number | null>(null);
  const [yearLow, setYearLow] = useState<number | null>(null);
  const [rangeLoading, setRangeLoading] = useState(false);

  useEffect(() => {
    if (!symbol) {
      setQuote(null);
      setCalcIndex(null);
      setStaticInfo(null);
      setPortfolio(null);
      setYearHigh(null);
      setYearLow(null);
      return;
    }

    let cancelled = false;

    client.market.getQuote(symbol).then((res) => {
      if (!cancelled) setQuote(res.ok ? res.data : null);
    });
    client.market.getCalcIndex(symbol).then((res) => {
      if (!cancelled) setCalcIndex(res.ok ? res.data : null);
    });
    client.market.getStaticInfo(symbol).then((res) => {
      if (!cancelled) setStaticInfo(res.ok ? res.data : null);
    });
    client.market.getPortfolio().then((res) => {
      if (!cancelled) setPortfolio(res.ok ? res.data : null);
    });

    setRangeLoading(true);
    client.market
      .getKline({ symbol, period: '1d', limit: 260 })
      .then((res) => {
        if (cancelled) return;
        if (!res.ok || res.data.length === 0) {
          setYearHigh(null);
          setYearLow(null);
          return;
        }
        const closes = res.data.map((k: Kline) => k.close);
        setYearHigh(Math.max(...closes));
        setYearLow(Math.min(...closes));
      })
      .finally(() => {
        if (!cancelled) setRangeLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [client, symbol]);

  if (!symbol) return null;

  const position: Position | undefined = portfolio?.positions.find(
    (p) => p.symbol === symbol
  );
  const portfolioWeight =
    position && portfolio && portfolio.totalValue > 0
      ? (position.marketValue / portfolio.totalValue) * 100
      : null;

  return (
    <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
      {/* Quote */}
      <Block title="Quote">
        {quote ? (
          <>
            <Metric
              label="Last"
              value={fmtPrice(quote.lastPrice)}
              color={signColor(quote.change)}
            />
            <Metric
              label="Change"
              value={`${fmtSigned(quote.change)} (${quote.change >= 0 ? '+' : ''}${fmtPercent(quote.changePercent)})`}
              color={signColor(quote.change)}
            />
            <Metric label="Volume" value={fmtNumber(quote.volume)} />
          </>
        ) : (
          <Metric label="Quote" value={DASH} />
        )}
      </Block>

      {/* Performance */}
      <Block title="Performance">
        {quote ? (
          <>
            <Metric label="Day Range" value={`${fmtPrice(quote.low)} – ${fmtPrice(quote.high)}`} />
            <Metric label="Open" value={fmtPrice(quote.open)} />
            <Metric label="Prev Close" value={fmtPrice(quote.prevClose)} />
          </>
        ) : (
          <Metric label="Day Range" value={DASH} />
        )}
        {rangeLoading ? (
          <Metric label="52W Range" value="Loading…" />
        ) : yearHigh !== null && yearLow !== null ? (
          <Metric label="52W Range" value={`${fmtPrice(yearLow)} – ${fmtPrice(yearHigh)}`} />
        ) : (
          <Metric label="52W Range" value={DASH} />
        )}
      </Block>

      {/* Valuation */}
      <Block title="Valuation">
        {calcIndex ? (
          <>
            <Metric label="PE" value={calcIndex.pe != null ? calcIndex.pe.toFixed(2) : DASH} />
            <Metric label="PB" value={calcIndex.pb != null ? calcIndex.pb.toFixed(2) : DASH} />
            <Metric
              label="DPS Rate"
              value={calcIndex.dpsRate != null ? fmtPercent(calcIndex.dpsRate) : DASH}
            />
            <Metric
              label="Turnover Rate"
              value={calcIndex.turnoverRate != null ? fmtPercent(calcIndex.turnoverRate) : DASH}
            />
            <Metric
              label="Total Market Value"
              value={
                calcIndex.totalMarketValue != null
                  ? fmtNumber(calcIndex.totalMarketValue)
                  : DASH
              }
            />
          </>
        ) : (
          <Metric label="Valuation" value={DASH} />
        )}
      </Block>

      {/* Basic Fundamentals */}
      <Block title="Basic Fundamentals">
        {staticInfo ? (
          <>
            <Metric label="EPS" value={staticInfo.eps != null ? staticInfo.eps.toFixed(2) : DASH} />
            <Metric
              label="EPS (TTM)"
              value={staticInfo.epsTtm != null ? staticInfo.epsTtm.toFixed(2) : DASH}
            />
            <Metric
              label="Dividend"
              value={staticInfo.dividend != null ? staticInfo.dividend.toFixed(4) : DASH}
            />
            <Metric
              label="Total Shares"
              value={
                staticInfo.totalShares != null ? fmtNumber(staticInfo.totalShares) : DASH
              }
            />
          </>
        ) : (
          <Metric label="Fundamentals" value={DASH} />
        )}
      </Block>

      {/* Position */}
      <Block title="Position">
        {position ? (
          <>
            <Metric label="Quantity" value={fmtNumber(position.quantity)} />
            <Metric label="Avg Cost" value={fmtPrice(position.avgCost)} />
            <Metric label="Market Value" value={fmtPrice(position.marketValue)} />
            <Metric
              label="Unrealized PnL"
              value={`${fmtSigned(position.unrealizedPnL)} (${position.unrealizedPnLPercent >= 0 ? '+' : ''}${fmtPercent(position.unrealizedPnLPercent)})`}
              color={signColor(position.unrealizedPnL)}
            />
            <Metric
              label="Portfolio Weight"
              value={portfolioWeight != null ? fmtPercent(portfolioWeight) : DASH}
            />
          </>
        ) : (
          <Metric label="No position" value={DASH} />
        )}
      </Block>
    </div>
  );
};
