import React, { useEffect, useState } from 'react';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import type {
  Quote,
  Kline,
  CalcIndex,
  StaticInfo,
  Holding,
  PortfolioSnapshot,
} from '@finagent/core';
import { activeSymbolAtom } from '../../atoms';
import { formatMoney, formatPercent, formatQuantity, formatSignedMoney } from '../../lib/money';
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
  <section className="rounded-[14px] border border-[var(--mac-border)] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.035)]">
    <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.11em] text-foreground/48">
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
  <div className="flex min-h-8 items-center justify-between gap-3 border-b border-[var(--mac-border)]/70 py-1 last:border-b-0">
    <span className="text-[12px] text-foreground/54">{label}</span>
    <span
      className={`text-right text-[13px] font-medium text-foreground ${mono ? 'tabular-nums' : ''}`}
      style={color ? { color } : undefined}
    >
      {value}
    </span>
  </div>
);

export const OverviewView: React.FC = () => {
  const { t } = useTranslation();
  const client = useFinagentClient();
  const symbol = useAtomValue(activeSymbolAtom);

  const [quote, setQuote] = useState<Quote | null>(null);
  const [calcIndex, setCalcIndex] = useState<CalcIndex | null>(null);
  const [staticInfo, setStaticInfo] = useState<StaticInfo | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioSnapshot | null>(null);
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

  const holding: Holding | undefined = portfolio?.holdings.find(
    (h) => h.symbol === symbol
  );
  const holdingValue = holding ? (holding.marketValueBase ?? holding.marketValue ?? 0) : 0;
  const totalAssets = portfolio?.totalAssets ?? 0;
  const portfolioWeight =
    holding && totalAssets > 0
      ? (holdingValue / totalAssets) * 100
      : null;

  return (
    <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
      {/* Quote */}
      <Block title={t('security.overview.quote')}>
        {quote ? (
          <>
            <Metric
              label={t('security.overview.last')}
              value={fmtPrice(quote.lastPrice)}
              color={signColor(quote.change)}
            />
            <Metric
              label={t('security.overview.change')}
              value={`${fmtSigned(quote.change)} (${quote.change >= 0 ? '+' : ''}${fmtPercent(quote.changePercent)})`}
              color={signColor(quote.change)}
            />
            <Metric label={t('security.header.volume')} value={fmtNumber(quote.volume)} />
          </>
        ) : (
          <Metric label={t('security.overview.quote')} value={DASH} />
        )}
      </Block>

      {/* Performance */}
      <Block title={t('security.overview.performance')}>
        {quote ? (
          <>
            <Metric label={t('security.overview.dayRange')} value={`${fmtPrice(quote.low)} – ${fmtPrice(quote.high)}`} />
            <Metric label={t('security.header.open')} value={fmtPrice(quote.open)} />
            <Metric label={t('security.header.prevClose')} value={fmtPrice(quote.prevClose)} />
          </>
        ) : (
          <Metric label={t('security.overview.dayRange')} value={DASH} />
        )}
        {rangeLoading ? (
          <Metric label={t('security.overview.week52Range')} value={t('common.loading')} />
        ) : yearHigh !== null && yearLow !== null ? (
          <Metric label={t('security.overview.week52Range')} value={`${fmtPrice(yearLow)} – ${fmtPrice(yearHigh)}`} />
        ) : (
          <Metric label={t('security.overview.week52Range')} value={DASH} />
        )}
      </Block>

      {/* Valuation */}
      <Block title={t('security.overview.valuation')}>
        {calcIndex ? (
          <>
            <Metric label={t('security.overview.pe')} value={calcIndex.pe != null ? calcIndex.pe.toFixed(2) : DASH} />
            <Metric label={t('security.overview.pb')} value={calcIndex.pb != null ? calcIndex.pb.toFixed(2) : DASH} />
            <Metric
              label={t('security.overview.dpsRate')}
              value={calcIndex.dpsRate != null ? fmtPercent(calcIndex.dpsRate) : DASH}
            />
            <Metric
              label={t('security.overview.turnoverRate')}
              value={calcIndex.turnoverRate != null ? fmtPercent(calcIndex.turnoverRate) : DASH}
            />
            <Metric
              label={t('security.overview.totalMarketValue')}
              value={
                calcIndex.totalMarketValue != null
                  ? fmtNumber(calcIndex.totalMarketValue)
                  : DASH
              }
            />
          </>
        ) : (
          <Metric label={t('security.overview.valuation')} value={DASH} />
        )}
      </Block>

      {/* Basic Fundamentals */}
      <Block title={t('security.overview.basicFundamentals')}>
        {staticInfo ? (
          <>
            <Metric label={t('security.overview.eps')} value={staticInfo.eps != null ? staticInfo.eps.toFixed(2) : DASH} />
            <Metric
              label={t('security.overview.epsTtm')}
              value={staticInfo.epsTtm != null ? staticInfo.epsTtm.toFixed(2) : DASH}
            />
            <Metric
              label={t('security.overview.dividend')}
              value={staticInfo.dividend != null ? staticInfo.dividend.toFixed(4) : DASH}
            />
            <Metric
              label={t('security.overview.totalShares')}
              value={
                staticInfo.totalShares != null ? fmtNumber(staticInfo.totalShares) : DASH
              }
            />
          </>
        ) : (
          <Metric label={t('security.overview.basicFundamentals')} value={DASH} />
        )}
      </Block>

      {/* Position */}
      <Block title={t('security.overview.position')}>
        {holding ? (
          <>
            <Metric label={t('security.overview.quantity')} value={formatQuantity(holding.quantity)} />
            <Metric label={t('security.overview.avgCost')} value={formatMoney(holding.costPrice, holding.currency)} />
            <Metric label={t('security.overview.marketValue')} value={formatMoney(holding.marketValue, holding.currency)} />
            <Metric
              label={t('security.overview.unrealizedPnL')}
              value={`${formatSignedMoney(holding.unrealizedPnL, holding.currency)} (${formatPercent(holding.unrealizedPnLPercent)})`}
              color={signColor(holding.unrealizedPnL ?? 0)}
            />
            <Metric
              label={t('security.overview.portfolioWeight')}
              value={portfolioWeight != null ? fmtPercent(portfolioWeight) : DASH}
            />
          </>
        ) : (
          <Metric label={t('security.overview.noPosition')} value={DASH} />
        )}
      </Block>
    </div>
  );
};
