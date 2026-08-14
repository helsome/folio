/**
 * V5 research strategy presets and plan resolution (spec §11–16).
 *
 * Presets are the product-facing strategy catalogue; the research planner
 * consumes them to build per-strategy fetch plans.
 */
export {
  COMPREHENSIVE_CAPABILITY_IDS,
  RESEARCH_STRATEGIES,
  isStrategyId,
} from './presets.ts';
export { strategyCapabilityIds } from './planner.ts';
export type { ResearchStrategy, StrategyId } from '@finagent/core';
