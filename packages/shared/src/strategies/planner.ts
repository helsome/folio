import type { StrategyId } from '@finagent/core';
import { COMPREHENSIVE_CAPABILITY_IDS, RESEARCH_STRATEGIES } from './presets.ts';

/**
 * Resolve the ordered capability plan for a strategy.
 *
 * The result is always a subsequence of `COMPREHENSIVE_CAPABILITY_IDS` in its
 * canonical order, so reports stay comparable across strategies. When
 * `strategyId` is undefined the caller's `basePlan` is returned untouched —
 * legacy (strategy-less) runs keep their fixed plan.
 */
export function strategyCapabilityIds(
  strategyId: StrategyId | undefined,
  basePlan: readonly string[] = COMPREHENSIVE_CAPABILITY_IDS
): readonly string[] {
  if (strategyId === undefined) return basePlan;
  return RESEARCH_STRATEGIES[strategyId].capabilityIds;
}
