import React from 'react';

/**
 * Data-source freshness line (spec §34): "Longbridge · Updated 13:45:12".
 * Renders nothing until a timestamp is available — never fabricates one.
 */
export const DataFreshness: React.FC<{
  providerName?: string;
  /** Epoch ms. */
  updatedAtMs?: number;
  delayed?: boolean;
  className?: string;
}> = ({ providerName, updatedAtMs, delayed = false, className }) => {
  if (!updatedAtMs || !Number.isFinite(updatedAtMs) || updatedAtMs <= 0) return null;
  const time = new Date(updatedAtMs).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const source = providerName ? `${providerName} · ` : '';
  return (
    <span className={`text-[10.5px] tabular-nums text-foreground/42 ${className ?? ''}`}>
      {source}Updated {time}
      {delayed ? ' · Delayed' : ''}
    </span>
  );
};
