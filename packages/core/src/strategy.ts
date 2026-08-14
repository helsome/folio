/**
 * V5 Research Strategy domain (spec §11–16).
 *
 * A strategy is a PRODUCT-facing orchestration layer: it maps a strategy to
 * existing skills (the agent knowledge layer) and to capabilities (the data
 * layer), and the research planner consumes it. Strategies never duplicate
 * skill prompts — they reuse them.
 */
import type { CapabilityId } from './capability.ts';

export type StrategyId =
  | 'comprehensive'
  | 'value'
  | 'growth'
  | 'technical'
  | 'earnings'
  | 'event-driven'
  | 'risk-review'
  | 'income';

export interface ResearchStrategy {
  id: StrategyId;
  name: string;
  /** One-line product copy. */
  description: string;
  /** User-facing focus chips, e.g. 'valuation', 'cash flow', 'ROE'. */
  focus: string[];
  /** Existing skill ids the strategy activates (agent knowledge layer). */
  skillIds: string[];
  /** Capability ids the strategy's research plan fetches. */
  capabilityIds: CapabilityId[];
}

export const STRATEGY_IDS: readonly StrategyId[] = [
  'comprehensive',
  'value',
  'growth',
  'technical',
  'earnings',
  'event-driven',
  'risk-review',
  'income',
] as const;
