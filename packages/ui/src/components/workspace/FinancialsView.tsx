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
  <tr className="border-b border-[var(--mac-border)] last:border-b-0">
    <td className="py-2 pr-4 text-[12px] text-foreground/54">{label}</td>
    <td className="py-2 text-right text-[13px] font-medium tabular-nums text-foreground">
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
      <div className="rounded-[10px] border border-[var(--mac-border)] bg-[var(--mac-blue-soft)] px-4 py-3 text-[12px] text-foreground/70">
        {t('security.financials.banner')}
      </div>

      <section className="mac-stock-tile rounded-[12px] p-4">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-foreground/48">
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

      <section className="mac-stock-tile rounded-[12px] p-4">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-foreground/48">
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
  );
};
