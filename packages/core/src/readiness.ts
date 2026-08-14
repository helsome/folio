import type { CapabilityId } from './capability.ts';

/**
 * Skill Readiness — how completely a skill's declared capability requirements
 * are covered by the Capability Registry. Readiness is a pure function of
 * (skill requirements × registered capability ids).
 */

export type SkillReadinessStatus = 'ready' | 'partial' | 'unavailable';

/** A skill's declared capability requirements. */
export interface SkillCapabilityRequirements {
  required: CapabilityId[];
  optional: CapabilityId[];
}

export interface SkillReadiness {
  skillId: string;
  status: SkillReadinessStatus;
  required: CapabilityId[];
  optional: CapabilityId[];
  availableRequired: number;
  availableOptional: number;
  /** Required capabilities not present in the registry. */
  missing: CapabilityId[];
  /** Human summary, e.g. "6/6 capabilities" or "4/7 (2 optional)". */
  summary: string;
}
