import React from 'react';
import { useTranslation } from 'react-i18next';
import type { SkillReadiness } from '@finagent/core';
import type { SkillListItem } from '../../client';
import { SkillReadinessBadge } from './SkillReadinessBadge';
import { SkillToggle } from './SkillToggle';
import type { SkillToggleError } from './useSkillToggle';

export interface SkillRowProps {
  skill: SkillListItem;
  readiness?: SkillReadiness;
  /** Id of the skill currently toggling; all toggles are disabled while set. */
  togglingId: string | null;
  toggleError: SkillToggleError | null;
  onToggle: (skill: SkillListItem) => void;
  /** Open the detail drawer; `trigger` is refocused when the drawer closes. */
  onOpen: (skill: SkillListItem, trigger: HTMLElement) => void;
}

/**
 * A skills-home row: name, description, readiness badge, and an enabled
 * toggle. Clicking the row (or Enter/Space) opens the detail drawer. The
 * toggle is a separate control so activating it never opens the drawer.
 */
export const SkillRow: React.FC<SkillRowProps> = ({
  skill,
  readiness,
  togglingId,
  toggleError,
  onToggle,
  onOpen,
}) => {
  const { t } = useTranslation();
  const isToggling = togglingId === skill.id;
  const toggleBusy = togglingId !== null;
  const rowError = toggleError?.skillId === skill.id ? toggleError.message : null;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpen(skill, event.currentTarget);
    }
  };

  return (
    <div className="overflow-hidden border-b border-border last:border-b-0">
      <div
        role="button"
        tabIndex={0}
        data-testid={`skill-row-${skill.id}`}
        onClick={(event) => onOpen(skill, event.currentTarget)}
        onKeyDown={handleKeyDown}
        className="flex w-full cursor-pointer items-center gap-3 px-5 py-4 text-left transition-smooth hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-foreground">{skill.name}</div>
          {skill.description && (
            <div className="truncate text-[12px] text-foreground/54">{skill.description}</div>
          )}
        </div>
        <SkillReadinessBadge readiness={readiness} />
        <span
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <SkillToggle
            checked={skill.enabled}
            onChange={() => onToggle(skill)}
            disabled={toggleBusy}
            loading={isToggling}
            label={`${skill.enabled ? t('settings.skills.disable') : t('settings.skills.enable')} ${skill.name}`}
          />
        </span>
      </div>
      {rowError && (
        <div
          role="alert"
          data-testid={`skill-toggle-error-${skill.id}`}
          className="border-t border-border bg-destructive/5 px-5 py-2.5 text-[12px] text-destructive"
        >
          {rowError}
        </div>
      )}
    </div>
  );
};
