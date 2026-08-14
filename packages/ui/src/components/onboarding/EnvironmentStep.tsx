import React from 'react';
import type { HealthCheckItem, HealthCheckReport } from '../../client/connections';

const ITEMS: Array<{ key: keyof HealthCheckReport; label: string }> = [
  { key: 'ai', label: 'AI' },
  { key: 'marketData', label: 'Market Data' },
  { key: 'skills', label: 'Skills' },
  { key: 'agentRuntime', label: 'Agent Runtime' },
];

const ItemRow: React.FC<{ label: string; item: HealthCheckItem }> = ({ label, item }) => (
  <div className="flex items-center justify-between gap-4 rounded-[10px] border mac-section-divider px-3 py-2">
    <span className="text-[13px] font-medium text-foreground">{label}</span>
    <span className="flex items-center gap-2 text-[12px]">
      {item.ok ? (
        <span className="text-[var(--mac-green)]">✓</span>
      ) : (
        <span className="text-[var(--mac-red)]">✗</span>
      )}
      <span className="text-foreground/60">
        {item.ok
          ? item.detail ?? 'Ready'
          : item.error?.message ?? item.detail ?? 'Unavailable'}
      </span>
    </span>
  </div>
);

/** Check Environment (spec §30): health:check rendered as a ✓/✗ list. */
export const EnvironmentStep: React.FC<{
  report: HealthCheckReport | null;
  loading: boolean;
}> = ({ report, loading }) => {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-[18px] font-semibold text-foreground">Check Environment</h2>
        <p className="text-[13px] text-foreground/66">
          A quick check that everything you connected is ready to use.
        </p>
      </div>

      {loading ? (
        <div className="text-[12px] text-foreground/48">Checking environment…</div>
      ) : report ? (
        <div className="space-y-2">
          {ITEMS.map(({ key, label }) => (
            <ItemRow key={key} label={label} item={report[key]} />
          ))}
        </div>
      ) : (
        <div className="rounded-[10px] border mac-section-divider p-4 text-[12px] text-foreground/48">
          Health checks aren&apos;t available in this build yet.
        </div>
      )}
    </div>
  );
};
