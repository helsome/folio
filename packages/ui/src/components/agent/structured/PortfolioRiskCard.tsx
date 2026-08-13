import React from 'react';
import type { Portfolio, Position } from '@finagent/core';
import { MetricGrid } from './MetricGrid';

type RiskLevel = 'HIGH' | 'MED' | 'LOW';

const fmtMoney = (n: number | null | undefined): string =>
  n == null || Number.isNaN(n) ? '—' : `$${n.toFixed(2)}`;

const fmtPct = (n: number | null | undefined): string =>
  n == null || Number.isNaN(n) ? '—' : `${n.toFixed(1)}%`;

interface PortfolioRiskCardProps {
  portfolio: Portfolio;
}

/** Renders concentration risk derived from a get_portfolio tool result. */
export const PortfolioRiskCard: React.FC<PortfolioRiskCardProps> = ({ portfolio }) => {
  const totalValue = portfolio.totalValue;
  const cash = portfolio.cash;
  const positions: Position[] = Array.isArray(portfolio.positions) ? portfolio.positions : [];

  const largest = positions.reduce<Position | null>(
    (acc, position) =>
      !acc || (position.marketValue ?? 0) > (acc.marketValue ?? 0) ? position : acc,
    null
  );

  const largestWeightPct =
    largest && totalValue > 0 ? ((largest.marketValue ?? 0) / totalValue) * 100 : null;
  const cashPct = totalValue > 0 ? (cash / totalValue) * 100 : null;

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
    <div className="mac-stock-tile rounded-[14px] p-3.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-foreground/40">
          Portfolio risk
        </span>
        <span className={`text-[12px] font-bold ${riskTone}`}>{risk ?? '—'}</span>
      </div>
      <div className="mt-3">
        <MetricGrid
          columns={2}
          items={[
            { label: 'Total value', value: fmtMoney(totalValue) },
            { label: 'Cash', value: fmtMoney(cash) },
            { label: 'Cash %', value: fmtPct(cashPct) },
            { label: 'Largest position', value: largest?.symbol ?? '—' },
            { label: 'Largest weight', value: fmtPct(largestWeightPct) },
            { label: 'Positions', value: positions.length },
          ]}
        />
      </div>
    </div>
  );
};
