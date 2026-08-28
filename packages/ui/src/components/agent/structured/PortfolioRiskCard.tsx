import React from 'react';
import { useTranslation } from 'react-i18next';
import type { Holding, PortfolioSnapshot } from '@finagent/core';
import { MetricGrid } from './MetricGrid';
import { formatMoney } from '../../../lib/money';

type RiskLevel = 'HIGH' | 'MED' | 'LOW';

const fmtPct = (n: number | null | undefined): string =>
  n == null || Number.isNaN(n) ? '—' : `${n.toFixed(1)}%`;

interface PortfolioRiskCardProps {
  portfolio: PortfolioSnapshot;
}

/** Renders concentration risk derived from a get_portfolio tool result. */
export const PortfolioRiskCard: React.FC<PortfolioRiskCardProps> = ({ portfolio }) => {
  const { t } = useTranslation();
  const totalValue = portfolio.totalAssets;
  const cash = portfolio.cash;
  const currency = portfolio.baseCurrency;
  const positions: Holding[] = Array.isArray(portfolio.holdings) ? portfolio.holdings : [];

  const largest = positions.reduce<Holding | null>((acc, position) => {
    const value = position.marketValueBase ?? position.marketValue ?? 0;
    const accValue = acc ? (acc.marketValueBase ?? acc.marketValue ?? 0) : 0;
    return !acc || value > accValue ? position : acc;
  }, null);

  const largestValue = largest ? (largest.marketValueBase ?? largest.marketValue ?? 0) : 0;
  const largestWeightPct = largest && totalValue !== undefined && totalValue > 0
    ? (largestValue / totalValue) * 100
    : null;
  const cashPct = totalValue !== undefined && totalValue > 0 && cash !== undefined
    ? (cash / totalValue) * 100
    : null;

  const risk: RiskLevel | null =
    largestWeightPct == null
      ? null
      : largestWeightPct > 40
        ? 'HIGH'
        : largestWeightPct > 20
          ? 'MED'
          : 'LOW';

  const riskTone =
    risk === 'HIGH'
      ? 'text-[var(--mac-red)]'
      : risk === 'MED'
        ? 'text-[var(--mac-yellow)]'
        : 'text-[var(--mac-green)]';

  return (
    <div className="mac-stock-tile rounded-[12px] p-3.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-foreground/40">
          {t('agent.risk.title')}
        </span>
        <span className={`text-[12px] font-bold ${riskTone}`}>{risk ?? '—'}</span>
      </div>
      <div className="mt-3">
        <MetricGrid
          columns={2}
          items={[
            { label: t('agent.risk.totalValue'), value: formatMoney(totalValue, currency) },
            { label: t('agent.risk.cash'), value: formatMoney(cash, currency) },
            { label: t('agent.risk.cashPct'), value: fmtPct(cashPct) },
            { label: t('agent.risk.largestPosition'), value: largest?.symbol ?? '—' },
            { label: t('agent.risk.largestWeight'), value: fmtPct(largestWeightPct) },
            { label: t('agent.risk.positions'), value: positions.length },
          ]}
        />
      </div>
    </div>
  );
};
