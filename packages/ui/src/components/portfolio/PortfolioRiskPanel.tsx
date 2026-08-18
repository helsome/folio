import React from 'react';
import { useTranslation } from 'react-i18next';
import type { AllocationItem, PortfolioRiskReport, RiskSignal } from '@finagent/core';
import { severityVisual } from '../../atoms/portfolioRiskAtoms';
import { formatCurrency, formatPercentRatio } from '@finagent/i18n';

interface PortfolioRiskPanelProps {
  report: PortfolioRiskReport;
}

/** Renders the PortfolioRiskReport: summary, concentration, allocation, and signals. */
export const PortfolioRiskPanel: React.FC<PortfolioRiskPanelProps> = ({ report }) => {
  const { t } = useTranslation();
  const { summary, allocation, concentration, signals } = report;
  const earnings = signals.filter((s) => s.kind === 'upcoming_earnings');
  const otherSignals = signals.filter((s) => s.kind !== 'upcoming_earnings');

  return (
    <div className="space-y-3" data-testid="portfolio-risk-panel">
      <div className="mac-stock-tile rounded-[14px] p-4">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-foreground/48">
          {t('portfolio.riskSummary')}
        </h3>
        <p className="text-[13px] leading-relaxed text-foreground/78">{summary}</p>
      </div>

      <div className="mac-stock-tile rounded-[14px] p-4">
        <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-foreground/48">
          {t('portfolio.concentration')}
        </h3>
        <div className="grid grid-cols-3 gap-3">
          <ConcentrationMetric
            label={t('portfolio.topPosition')}
            value={formatPercentRatio(concentration.top1Weight)}
          />
          <ConcentrationMetric
            label={t('portfolio.topFive')}
            value={formatPercentRatio(concentration.top5Weight)}
          />
          <ConcentrationMetric
            label={t('portfolio.herfindahl')}
            value={concentration.herfindahl.toFixed(2)}
          />
        </div>
      </div>

      <div className="mac-stock-tile rounded-[14px] p-4">
        <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-foreground/48">
          {t('portfolio.allocation')} ({allocation.length})
        </h3>
        {allocation.length === 0 ? (
          <div className="py-6 text-center text-[13px] text-foreground/44">
            {t('portfolio.noPositions')}
          </div>
        ) : (
          <div className="space-y-2">
            {allocation.map((item) => (
              <AllocationBar key={item.symbol} item={item} />
            ))}
          </div>
        )}
      </div>

      {earnings.length > 0 && (
        <div className="mac-stock-tile rounded-[14px] p-4">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-foreground/48">
            {t('portfolio.upcomingEarnings')}
          </h3>
          <ul className="space-y-1">
            {earnings.map((signal) => (
              <li key={signal.title} className="text-[13px] text-foreground/72">
                {signal.detail}
              </li>
            ))}
          </ul>
        </div>
      )}

      {otherSignals.length > 0 && (
        <div className="space-y-2">
          {otherSignals.map((signal) => (
            <SignalCard key={signalKey(signal)} signal={signal} />
          ))}
        </div>
      )}
    </div>
  );
};

const ConcentrationMetric: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <div className="text-[11px] text-foreground/48">{label}</div>
    <div className="text-[15px] font-semibold text-foreground">{value}</div>
  </div>
);

const AllocationBar: React.FC<{ item: AllocationItem }> = ({ item }) => (
  <div>
    <div className="mb-1 flex items-center justify-between text-[12px]">
      <span className="font-medium text-foreground/82">{item.symbol}</span>
      <span className="text-foreground/54">
        {formatCurrency(item.marketValue)} · {formatPercentRatio(item.weight)}
      </span>
    </div>
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/8">
      <div
        className="h-full rounded-full bg-[var(--mac-blue)] transition-all"
        style={{ width: `${Math.min(100, item.weight * 100).toFixed(1)}%` }}
      />
    </div>
  </div>
);

const SignalCard: React.FC<{ signal: RiskSignal }> = ({ signal }) => {
  const visual = severityVisual(signal.severity);
  return (
    <div className="mac-stock-tile rounded-[12px] p-3">
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: visual.color }}
        />
        <span className="text-[13px] font-semibold text-foreground/88">{signal.title}</span>
        <span className="ml-auto text-[11px] uppercase tracking-wide" style={{ color: visual.color }}>
          {visual.label}
        </span>
      </div>
      <div className="mt-1 text-[12px] leading-relaxed text-foreground/60">{signal.detail}</div>
    </div>
  );
};

function signalKey(signal: RiskSignal): string {
  return signal.symbol ? `${signal.kind}:${signal.symbol}` : signal.kind;
}
