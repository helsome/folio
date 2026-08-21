import React from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
  return (
    <div className="space-y-5 [&_[data-testid^='connection-card-']]:rounded-[8px] [&_[data-testid^='connection-card-']]:bg-surface-raised [&_[data-testid^='connection-card-']]:shadow-none">
      <div className="space-y-1 border-b border-border pb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-[18px] font-semibold text-foreground">{title}</h2>
          {recommended && (
            <span className="rounded-[5px] border border-accent/25 bg-accent/8 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
              {t('onboarding.providerStep.recommended')}
            </span>
          )}
        </div>
        <p className="text-[13px] text-foreground/66">{subtitle}</p>
      </div>

      {entry ? (
        <ConnectionCard entry={entry} onChanged={onChanged} />
      ) : (
        <div className="rounded-[8px] border border-border bg-surface-raised p-4 text-[12px] text-foreground/48">
          {t('onboarding.providerStep.notAvailable')}
        </div>
      )}
    </div>
  );
};
