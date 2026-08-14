import type {
  CapabilityId,
  CapabilityQueryFilter,
  CapabilityRegistry,
  FinanceCapability,
} from '@finagent/core';
import { createCapabilityError } from './validate.ts';

const ID_PATTERN = /^[a-z]+\.[a-zA-Z]+$/;

/**
 * Build a read-only `CapabilityRegistry`. Constructor-time validation enforces
 * the registry invariants: capability ids unique, toolNames unique, and id
 * format `<namespace>.<name>` (lowercase namespace, camelCase name). Violations
 * throw a code error naming the offending manifest.
 */
export function createCapabilityRegistry(capabilities: FinanceCapability[]): CapabilityRegistry {
  const byId = new Map<CapabilityId, FinanceCapability>();
  const byToolName = new Map<string, FinanceCapability>();

  for (const capability of capabilities) {
    if (!ID_PATTERN.test(capability.id)) {
      throw createCapabilityError(
        'CAPABILITY_ID_INVALID',
        `Capability "${capability.name}" declares invalid id "${capability.id}" (expected /^[a-z]+\\.[a-zA-Z]+$/).`
      );
    }
    if (byId.has(capability.id)) {
      throw createCapabilityError(
        'CAPABILITY_ID_DUPLICATE',
        `Duplicate capability id "${capability.id}" (manifest "${capability.name}").`
      );
    }
    if (byToolName.has(capability.toolName)) {
      throw createCapabilityError(
        'CAPABILITY_TOOL_DUPLICATE',
        `Duplicate toolName "${capability.toolName}" (declared by "${capability.id}" and "${byToolName.get(capability.toolName)?.id}").`
      );
    }
    byId.set(capability.id, capability);
    byToolName.set(capability.toolName, capability);
  }

  return {
    list() {
      return [...byId.values()];
    },
    get(id) {
      return byId.get(id);
    },
    query(filter: CapabilityQueryFilter = {}) {
      return [...byId.values()].filter((capability) => {
        if (filter.category && capability.category !== filter.category) return false;
        if (filter.auth && capability.auth !== filter.auth) return false;
        if (filter.riskLevel && capability.riskLevel !== filter.riskLevel) return false;
        return true;
      });
    },
  };
}
