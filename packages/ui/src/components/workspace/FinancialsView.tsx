import React, { useEffect, useState } from 'react';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import type { CalcIndex, StaticInfo } from '@finagent/core';
import { activeSymbolAtom } from '../../atoms';
import { useFinagentClient } from '../../client';

const DASH = '\u2014';

const fmtNumber = (value: number): string => value.toLocaleString();
const fmtPercent = (value: number): string => `${value.toFixed(2)}%`;

interface RowProps {
  label: string;
  value: string;
}

const Row: React.FC<RowProps> = ({ label, value }) => (
  <tr className="border-b border-[var(--mac-border)]/70 last:border-b-0">
    <td className="h-10 py-2 pr-4 text-[12px] text-foreground/54">{label}</td>
    <td className="h-10 py-2 text-right text-[13px] font-medium tabular-nums text-foreground">
      {value}
    </td>
  </tr>
);

export const FinancialsView: React.FC = () => {
  const { t } = useTranslation();
  const client = useFinagentClient();
  const symbol = useAtomValue(activeSymbolAtom);

  const [calcIndex, setCalcIndex] = useState<CalcIndex | null>(null);
  const [staticInfo, setStaticInfo] = useState<StaticInfo | null>(null);

  useEffect(() => {
    if (!symbol) {
      setCalcIndex(null);
      setStaticInfo(null);
      return;
    }

    let cancelled = false;

    client.market.getCalcIndex(symbol).then((res) => {
      if (!cancelled) setCalcIndex(res.ok ? res.data : null);
    });
    client.market.getStaticInfo(symbol).then((res) => {
      if (!cancelled) setStaticInfo(res.ok ? res.data : null);
    });

    return () => {
      cancelled = true;
    };
  }, [client, symbol]);

  if (!symbol) return null;

  return (
    <div className="space-y-3 p-4">
      <div className="rounded-[12px] border border-[var(--mac-blue)]/15 bg-[var(--mac-blue-soft)] px-4 py-3 text-[12px] leading-5 text-foreground/70">
        {t('security.financials.banner')}
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <section className="rounded-[14px] border border-[var(--mac-border)] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.035)]">
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.11em] text-foreground/48">
          {t('security.financials.valuationMetrics')}
        </h3>
        <table className="w-full">
          <tbody>
            <Row
              label={t('security.financials.pe')}
              value={calcIndex?.pe != null ? calcIndex.pe.toFixed(2) : DASH}
            />
            <Row
              label={t('security.financials.pb')}
              value={calcIndex?.pb != null ? calcIndex.pb.toFixed(2) : DASH}
            />
            <Row
              label={t('security.financials.dpsRate')}
              value={calcIndex?.dpsRate != null ? fmtPercent(calcIndex.dpsRate) : DASH}
            />
            <Row
              label={t('security.financials.turnoverRate')}
              value={
                calcIndex?.turnoverRate != null
                  ? fmtPercent(calcIndex.turnoverRate)
                  : DASH
              }
            />
            <Row
              label={t('security.financials.totalMarketValue')}
              value={
                calcIndex?.totalMarketValue != null
                  ? fmtNumber(calcIndex.totalMarketValue)
                  : DASH
              }
            />
          </tbody>
        </table>
      </section>

      <section className="rounded-[14px] border border-[var(--mac-border)] bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.035)]">
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.11em] text-foreground/48">
          {t('security.financials.staticInfo')}
        </h3>
        <table className="w-full">
          <tbody>
            <Row
              label={t('security.financials.eps')}
              value={staticInfo?.eps != null ? staticInfo.eps.toFixed(2) : DASH}
            />
            <Row
              label={t('security.financials.epsTtm')}
              value={staticInfo?.epsTtm != null ? staticInfo.epsTtm.toFixed(2) : DASH}
            />
            <Row
              label={t('security.financials.dps')}
              value={
                staticInfo?.dividend != null ? staticInfo.dividend.toFixed(4) : DASH
              }
            />
            <Row
              label={t('security.financials.bps')}
              value={staticInfo?.bps != null ? staticInfo.bps.toFixed(2) : DASH}
            />
            <Row
              label={t('security.financials.totalShares')}
              value={
                staticInfo?.totalShares != null
                  ? fmtNumber(staticInfo.totalShares)
                  : DASH
              }
            />
            <Row
              label={t('security.financials.circulatingShares')}
              value={
                staticInfo?.circulatingShares != null
                  ? fmtNumber(staticInfo.circulatingShares)
                  : DASH
              }
            />
          </tbody>
        </table>
      </section>
      </div>
    </div>
  );
};
