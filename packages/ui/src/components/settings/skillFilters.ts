import type { SkillReadiness } from '@finagent/core';
import type { SkillListItem } from '../../client';
import { getSkillReadiness } from '../../atoms/skillReadinessAtoms';

/**
 * Skills-home filter model (pure — unit-tested).
 *
 * The four chips span two axes: readiness (Ready / Partial) and the enabled
 * toggle (Disabled). "Partial" is the "needs attention" bucket and therefore
 * also matches skills whose readiness is `unavailable` (none of the required
 * capabilities are registered).
 */
export type SkillStatusFilter = 'all' | 'ready' | 'partial' | 'disabled';

export const SKILL_STATUS_FILTERS: ReadonlyArray<{ value: SkillStatusFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'ready', label: 'Ready' },
  { value: 'partial', label: 'Partial' },
  { value: 'disabled', label: 'Disabled' },
];

/** Case-insensitive text match against name, description, id, and keywords. */
export function matchesSkillQuery(skill: SkillListItem, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    skill.name.toLowerCase().includes(needle) ||
    skill.description.toLowerCase().includes(needle) ||
    skill.id.toLowerCase().includes(needle) ||
    skill.keywords.some((keyword) => keyword.toLowerCase().includes(needle))
  );
}

/** Whether a skill satisfies a status chip. */
export function matchesSkillStatus(
  skill: SkillListItem,
  readiness: SkillReadiness | undefined,
  status: SkillStatusFilter
): boolean {
  switch (status) {
    case 'all':
      return true;
    case 'ready':
      return (readiness?.status ?? 'unavailable') === 'ready';
    case 'partial': {
      const value = readiness?.status ?? 'unavailable';
      return value === 'partial' || value === 'unavailable';
    }
    case 'disabled':
      return skill.enabled === false;
  }
}

/** Apply search text + status chip to the full skill list. */
export function filterSkills(
  skills: SkillListItem[],
  readiness: SkillReadiness[],
  query: string,
  status: SkillStatusFilter
): SkillListItem[] {
  return skills.filter((skill) => {
    const entry = getSkillReadiness(readiness, skill.id);
    return matchesSkillQuery(skill, query) && matchesSkillStatus(skill, entry, status);
  });
}
