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
  type ProviderProvenance,
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
  execute(
    input: TInput,
    ctx?: CapabilityExecutionContext,
    reportProvider?: (provenance: ProviderProvenance) => void
  ): Promise<CapabilityResult<TOutput>>;
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
      let providerProvenance: ProviderProvenance | undefined;
      const result = await def.execute(validated, ctx, (provenance) => {
        providerProvenance = cloneProviderProvenance(provenance);
      });
      return attachInstrumentIdToProvenance(
        attachProviderProvenance(result, providerProvenance)
      );
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

function attachProviderProvenance<T>(
  result: CapabilityResult<T>,
  providerProvenance?: ProviderProvenance
): CapabilityResult<T> {
  if (!providerProvenance) return result;

  const failoverTrail = providerProvenance.failoverTrail?.map((step) => ({ ...step }));
  const routingLineage = failoverTrail?.map((step) => ({
    kind: 'fallback' as const,
    description: `Provider routing skipped ${step.providerId} after ${step.attempts} attempt${step.attempts === 1 ? '' : 's'} (${step.code}; ${step.kind}).`,
  })) ?? [];
  const firstFailure = failoverTrail?.[0];
  const fallback = !providerProvenance.stale
    && firstFailure
    && firstFailure.providerId !== providerProvenance.providerId
    ? {
      from: firstFailure.providerId,
      to: providerProvenance.providerId,
      reason: failoverTrail.map((step) => step.code).join(' → '),
    }
    : undefined;
  const evidence = routingLineage.length > 0 || fallback
    ? {
      ...result.evidence,
      ...(result.evidence?.fallback || !fallback ? {} : { fallback }),
      ...(routingLineage.length > 0
        ? { lineage: [...routingLineage, ...(result.evidence?.lineage ?? [])] }
        : {}),
    }
    : result.evidence;

  return {
    ...result,
    provenance: {
      ...result.provenance,
      provider: providerProvenance.providerId,
      providerId: providerProvenance.providerId,
      providerName: providerProvenance.providerName,
      ...(providerProvenance.instrumentId ? { instrumentId: providerProvenance.instrumentId } : {}),
      fetchedAt: providerProvenance.fetchedAt,
      ...(providerProvenance.marketTime !== undefined
        ? { marketTime: providerProvenance.marketTime }
        : {}),
      ...(providerProvenance.delayed !== undefined
        ? { delayed: providerProvenance.delayed }
        : {}),
      stale: providerProvenance.stale,
      ...(failoverTrail ? { failoverTrail } : {}),
    },
    ...(evidence ? { evidence } : {}),
  };
}

function cloneProviderProvenance(provenance: ProviderProvenance): ProviderProvenance {
  return {
    ...provenance,
    ...(provenance.failoverTrail
      ? { failoverTrail: provenance.failoverTrail.map((step) => ({ ...step })) }
      : {}),
  };
}
