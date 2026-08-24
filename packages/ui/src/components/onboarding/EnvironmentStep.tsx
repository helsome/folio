import React from 'react';
import { useTranslation } from 'react-i18next';
import type { HealthCheckItem, HealthCheckReport } from '../../client/connections';

const ITEMS: Array<{ key: keyof HealthCheckReport; labelKey: string }> = [
  { key: 'ai', labelKey: 'onboarding.environment.itemAi' },
  { key: 'marketData', labelKey: 'onboarding.environment.itemMarketData' },
  { key: 'skills', labelKey: 'onboarding.environment.itemSkills' },
  { key: 'agentRuntime', labelKey: 'onboarding.environment.itemAgentRuntime' },
];

const ItemRow: React.FC<{ label: string; item: HealthCheckItem; t: (key: string) => string }> = ({
  label,
  item,
  t,
}) => (
  <div className="flex items-center justify-between gap-4 border-b border-border px-3 py-2.5 last:border-b-0">
    <span className="text-[13px] font-medium text-foreground">{label}</span>
    <span className="flex items-center gap-2 text-[12px]">
      {item.ok ? (
        <span className="text-[var(--mac-green)]">✓</span>
      ) : (
        <span className="text-[var(--mac-red)]">✗</span>
      )}
      <span className="text-foreground/60">
        {item.ok
          ? item.detail ?? t('onboarding.environment.ready')
          : item.error?.message ?? item.detail ?? t('onboarding.environment.unavailable')}
      </span>
    </span>
  </div>
);

/** Check Environment (spec §30): health:check rendered as a ✓/✗ list. */
export const EnvironmentStep: React.FC<{
  report: HealthCheckReport | null;
  loading: boolean;
}> = ({ report, loading }) => {
  const { t } = useTranslation();
  return (
    <div className="space-y-5">
      <div className="space-y-1 border-b border-border pb-4">
        <h2 className="text-[18px] font-semibold text-foreground">{t('onboarding.environment.title')}</h2>
        <p className="text-[13px] text-foreground/66">{t('onboarding.environment.subtitle')}</p>
      </div>

      {loading ? (
        <div className="text-[12px] text-foreground/48">{t('onboarding.environment.checking')}</div>
      ) : report ? (
        <div className="overflow-hidden rounded-[8px] border border-border bg-surface-raised">
          {ITEMS.map(({ key, labelKey }) => (
            <ItemRow key={key} label={t(labelKey)} item={report[key]} t={t} />
          ))}
        </div>
      ) : (
        <div className="rounded-[8px] border border-border bg-surface-raised p-4 text-[12px] text-foreground/48">
          {t('onboarding.environment.notAvailable')}
        </div>
      )}
    </div>
  );
};
