import React from 'react';
import type { SkillReadiness } from '@finagent/core';
import type { SkillListItem } from '../../client';
import { getSkillReadiness } from '../../atoms/skillReadinessAtoms';
import { SkillRow } from './SkillRow';
import type { SkillToggleError } from './useSkillToggle';

export interface SkillListProps {
  skills: SkillListItem[];
  readiness: SkillReadiness[];
  togglingId: string | null;
  toggleError: SkillToggleError | null;
  onToggle: (skill: SkillListItem) => void;
  onOpen: (skill: SkillListItem, trigger: HTMLElement) => void;
}

/** Maps the (already filtered) skill list onto interactive rows. */
export const SkillList: React.FC<SkillListProps> = ({
  skills,
  readiness,
  togglingId,
  toggleError,
  onToggle,
  onOpen,
}) => (
  <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm" data-testid="skill-list">
    {skills.map((skill) => (
      <SkillRow
        key={skill.id}
        skill={skill}
        readiness={getSkillReadiness(readiness, skill.id)}
        togglingId={togglingId}
        toggleError={toggleError}
        onToggle={onToggle}
        onOpen={onOpen}
      />
    ))}
  </div>
);
