import type { TSchema } from '@sinclair/typebox';
import {
  readInstrumentId,
  type CapabilityAuth,
  type CapabilityCategory,
  type CapabilityExecutionContext,
  type CapabilityId,
  type CapabilityResult,
  type CapabilityRiskLevel,
  type FinanceCapability,
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
 * manifest's own `execute`. Provenance picks up `instrumentId` from stamped
 * payloads when the manifest omitted it.
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
      return attachInstrumentIdToProvenance(await def.execute(validated, ctx));
    },
  };
}

function attachInstrumentIdToProvenance<T>(result: CapabilityResult<T>): CapabilityResult<T> {
  if (result.provenance.instrumentId) return result;
  const instrumentId = readInstrumentId(result.data);
  if (!instrumentId) return result;
  return {
    ...result,
    provenance: { ...result.provenance, instrumentId },
  };
}
