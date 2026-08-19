import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ResearchSection } from '@finagent/core';
import { capabilityLabelKey } from '../../lib/capabilityLabels';

/**
 * Evidence refs for one report section: claim → capability → fetch time.
 * The capability id is shown as its user-facing label (V9 §47 — "claim,
 * source, time"); unknown ids keep a stable neutral fallback instead of
 * leaking engineering terms into the normal report view.
 */
export const EvidenceList: React.FC<{ section: ResearchSection }> = ({ section }) => {
  const { t } = useTranslation();
  if (section.evidence.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      {section.evidence.map((ref) => {
        const labelKey = capabilityLabelKey(ref.capabilityId);
        const label = labelKey ? t(labelKey) : ref.capabilityId;
        return (
          <div
            key={ref.runId}
            className="flex flex-col gap-0.5 rounded-[8px] bg-foreground/4 px-3 py-2"
          >
            <span className="text-[12px] font-medium text-foreground/85">{ref.claim}</span>
            <span className="tnum text-[10.5px] text-text-muted">
              {label} · {new Date(ref.fetchedAt).toLocaleTimeString()}
              {ref.summary ? ` · ${ref.summary}` : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
};
