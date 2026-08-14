import type { TSchema } from '@sinclair/typebox';
import type {
  CapabilityAuth,
  CapabilityCategory,
  CapabilityExecutionContext,
  CapabilityId,
  CapabilityResult,
  CapabilityRiskLevel,
  FinanceCapability,
} from '@finagent/core';
import { validateInput } from './validate.ts';

/** Everything a manifest declares to become a `FinanceCapability`. */
export interface CapabilityDefinition<TInput = unknown, TOutput = unknown> {
  id: CapabilityId;
  name: string;
  description: string;
  category: CapabilityCategory;
  riskLevel: CapabilityRiskLevel;
  auth: CapabilityAuth;
  toolName: string;
  inputSchema: TSchema;
  execute(input: TInput, ctx?: CapabilityExecutionContext): Promise<CapabilityResult<TOutput>>;
}

/**
 * Build a `FinanceCapability` from a manifest. The returned `execute` first
 * validates `input` against `inputSchema` (TypeBox `Value.Check`) and throws a
 * `CAPABILITY_INPUT_INVALID` code error on mismatch, then delegates to the
 * manifest's own `execute`, passing the execution context through unchanged.
 */
export function defineCapability<TInput = unknown, TOutput = unknown>(
  def: CapabilityDefinition<TInput, TOutput>
): FinanceCapability<TInput, TOutput> {
  return {
    id: def.id,
    name: def.name,
    description: def.description,
    category: def.category,
    riskLevel: def.riskLevel,
    auth: def.auth,
    toolName: def.toolName,
    inputSchema: def.inputSchema,
    async execute(input, ctx) {
      const validated = validateInput<TInput>(def.inputSchema, input);
      return def.execute(validated, ctx);
    },
  };
}
