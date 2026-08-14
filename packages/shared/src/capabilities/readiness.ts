import type {
  CapabilityId,
  CapabilityRegistry,
  SkillCapabilityRequirements,
  SkillReadiness,
} from '@finagent/core';

/**
 * Pure readiness computation: how completely a skill's declared capability
 * requirements are covered by the registry. Never throws; missing capabilities
 * simply appear in `missing` and shrink the summary ratio.
 *
 *   all required present  → ready
 *   some required present → partial
 *   none required present → unavailable
 */
export function computeSkillReadiness(
  skillId: string,
  requirements: SkillCapabilityRequirements,
  registry: CapabilityRegistry
): SkillReadiness {
  const registered = new Set<CapabilityId>(registry.list().map((cap) => cap.id));
  const required = requirements.required;
  const availableRequired = required.filter((id) => registered.has(id)).length;
  const availableOptional = requirements.optional.filter((id) => registered.has(id)).length;
  const missing = required.filter((id) => !registered.has(id));
  const total = required.length;

  let status: SkillReadiness['status'];
  if (total === 0 || availableRequired === total) {
    status = 'ready';
  } else if (availableRequired === 0) {
    status = 'unavailable';
  } else {
    status = 'partial';
  }

  return {
    skillId,
    status,
    required,
    optional: requirements.optional,
    availableRequired,
    availableOptional,
    missing,
    summary: `${availableRequired}/${total} capabilities`,
  };
}
