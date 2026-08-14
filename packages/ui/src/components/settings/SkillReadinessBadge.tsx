import React from 'react';
import type { SkillReadiness } from '@finagent/core';
import { readinessVisual } from '../../atoms/skillReadinessAtoms';

interface SkillReadinessBadgeProps {
  /** Readiness entry for the skill; undefined renders the graceful gray state. */
  readiness?: SkillReadiness;
}

/**
 * Compact per-skill readiness indicator: colored status glyph (ready ●,
 * partial ◐, unavailable ○), a capability summary ("6/6 capabilities"), and
 * chips for each missing (required-but-unregistered) capability.
 */
export const SkillReadinessBadge: React.FC<SkillReadinessBadgeProps> = ({ readiness }) => {
  const visual = readinessVisual(readiness?.status);

  return (
    <span className="flex shrink-0 items-center gap-1.5 text-[11px]" title={visual.label}>
      <span aria-hidden="true" style={{ color: visual.color }}>
        {visual.icon}
      </span>
      <span className="text-foreground/56">{readiness ? readiness.summary : 'unavailable'}</span>
      {readiness && readiness.missing.length > 0 && (
        <span className="flex flex-wrap gap-1">
          {readiness.missing.map((capability) => (
            <span
              key={capability}
              className="rounded-[5px] border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-600"
            >
              {capability}
            </span>
          ))}
        </span>
      )}
    </span>
  );
};
