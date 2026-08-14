import React from 'react';
import type { ResearchSection } from '@finagent/core';

/** Evidence refs for one report section: claim → capability run → fetch time. */
export const EvidenceList: React.FC<{ section: ResearchSection }> = ({ section }) => {
  if (section.evidence.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      {section.evidence.map((ref) => (
        <div
          key={ref.runId}
          className="flex flex-col gap-0.5 rounded-[8px] bg-foreground/4 px-3 py-2"
        >
          <span className="text-[12px] font-medium text-foreground/85">{ref.claim}</span>
          <span className="tnum text-[10.5px] text-text-muted">
            {ref.capabilityId} · {new Date(ref.fetchedAt).toLocaleTimeString()}
            {ref.summary ? ` · ${ref.summary}` : ''}
          </span>
        </div>
      ))}
    </div>
  );
};
