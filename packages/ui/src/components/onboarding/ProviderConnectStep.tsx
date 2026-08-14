import React from 'react';
import type { ConnectionEntry } from '../../client/connections';
import { ConnectionCard } from '../settings/ConnectionCard';

export interface ProviderConnectStepProps {
  title: string;
  subtitle: string;
  recommended?: boolean;
  entry: ConnectionEntry | null;
  onChanged: () => void;
}

/**
 * A wizard step that presents a single provider card (spec §29–30). Used for
 * both "Connect Financial Data" and the optional broker facet of Longbridge.
 */
export const ProviderConnectStep: React.FC<ProviderConnectStepProps> = ({
  title,
  subtitle,
  recommended = false,
  entry,
  onChanged,
}) => {
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <h2 className="text-[18px] font-semibold text-foreground">{title}</h2>
          {recommended && (
            <span className="rounded-full border border-[var(--mac-blue)]/30 bg-[var(--mac-blue)]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--mac-blue)]">
              Recommended
            </span>
          )}
        </div>
        <p className="text-[13px] text-foreground/66">{subtitle}</p>
      </div>

      {entry ? (
        <ConnectionCard entry={entry} onChanged={onChanged} />
      ) : (
        <div className="rounded-[10px] border mac-section-divider p-4 text-[12px] text-foreground/48">
          This provider isn&apos;t available in this build yet — connect it later from Settings →
          Connections.
        </div>
      )}
    </div>
  );
};
