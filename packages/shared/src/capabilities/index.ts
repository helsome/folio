import { createCapabilityRegistry } from './registry.ts';
import { createPhaseOneCapabilities } from './manifests/index.ts';
import { createPhaseTwoCapabilities } from './manifests/phase-two.ts';
import type { CapabilityFetchers } from './fetchers.ts';

/** Phase-1 registry built from the default (real) Longbridge fetchers. */
export function createPhaseOneRegistry(fetchers?: CapabilityFetchers) {
  return createCapabilityRegistry(createPhaseOneCapabilities(fetchers));
}

/** Phase-2 registry: the twelve wave-2 capabilities. */
export function createPhaseTwoRegistry(fetchers?: CapabilityFetchers) {
  return createCapabilityRegistry(createPhaseTwoCapabilities(fetchers));
}

/**
 * The full Folio V3 registry: phase-1 + phase-2 capabilities, one source of
 * truth for agent tools, UI availability, and product workflows.
 */
export function createFullRegistry(fetchers?: CapabilityFetchers) {
  return createCapabilityRegistry([
    ...createPhaseOneCapabilities(fetchers),
    ...createPhaseTwoCapabilities(fetchers),
  ]);
}

export { createCapabilityRegistry };
export { defineCapability, type CapabilityDefinition } from './define.ts';
export {
  CapabilityExecutor,
  type CapabilityExecutorOptions,
  type RunOptions,
  type RunOutcome,
  type RunAllOptions,
  type RunAllSpec,
} from './executor.ts';
export { computeSkillReadiness } from './readiness.ts';
export { createCapabilityTools, type CapabilityTool } from './pi-tools.ts';
export { createCapabilityError, validateInput, normalizeSymbol } from './validate.ts';
export { defaultCapabilityFetchers, type CapabilityFetchers } from './fetchers.ts';
export { createPhaseOneCapabilities, phaseOneCapabilities } from './manifests/index.ts';

/** All twenty capabilities built from the default (real) Longbridge fetchers. */
export const fullCapabilities = [
  ...createPhaseOneCapabilities(),
  ...createPhaseTwoCapabilities(),
];
export { createPhaseTwoCapabilities } from './manifests/phase-two.ts';
