import React, { useCallback, useState } from 'react';
import type { FinagentClient, SkillListItem } from '../../client';
import { flipSkillEnabled } from './skillToggleState';

/** An inline toggle failure, scoped to the skill that triggered it. */
export interface SkillToggleError {
  skillId: string;
  message: string;
}

export interface SkillToggleController {
  /** Skill id currently being toggled (null when idle). */
  togglingId: string | null;
  /** Latest rollback error, if the last toggle failed. */
  toggleError: SkillToggleError | null;
  /** Optimistically toggle a skill; rolls back + surfaces an error on failure. */
  toggle: (skill: SkillListItem) => Promise<void>;
  clearToggleError: () => void;
}

const FALLBACK_TOGGLE_ERROR = 'Failed to update skill.';

/**
 * Optimistic enable/disable controller. Disables the control surface while a
 * request is in flight (callers pass `togglingId` to every toggle) so a second
 * click cannot race the first against the persisted state file.
 */
export function useSkillToggle(
  client: FinagentClient,
  setSkills: React.Dispatch<React.SetStateAction<SkillListItem[]>>
): SkillToggleController {
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<SkillToggleError | null>(null);

  const toggle = useCallback(
    async (skill: SkillListItem) => {
      const next = !skill.enabled;
      setTogglingId(skill.id);
      setToggleError(null);
      setSkills((prev) => flipSkillEnabled(prev, skill.id)); // optimistic

      try {
        const result = await client.skills.setEnabled(skill.id, next);
        if (!result.ok) {
          setSkills((prev) => flipSkillEnabled(prev, skill.id)); // rollback
          setToggleError({
            skillId: skill.id,
            message: result.error.message || FALLBACK_TOGGLE_ERROR,
          });
        }
      } catch {
        setSkills((prev) => flipSkillEnabled(prev, skill.id)); // rollback
        setToggleError({ skillId: skill.id, message: FALLBACK_TOGGLE_ERROR });
      } finally {
        setTogglingId(null);
      }
    },
    [client, setSkills]
  );

  const clearToggleError = useCallback(() => setToggleError(null), []);

  return { togglingId, toggleError, toggle, clearToggleError };
}
