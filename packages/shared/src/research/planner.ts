import type { CapabilityRegistry, StrategyId } from '@finagent/core';
import { strategyCapabilityIds } from '../strategies/planner.ts';

/**
 * Ordered capability plan for a Deep Research run. Fixed so reports are
 * comparable across symbols. Capabilities missing from the registry are kept
 * as planned-but-unavailable entries — the report shows "unavailable", never
 * silently drops a planned dimension.
 */
export const RESEARCH_CAPABILITY_PLAN = [
  'company.profile',
  'market.quote',
  'market.kline',
  'company.valuation',
  'company.financials',
  'company.earnings',
  'company.ratings',
  'research.news',
  'market.capitalFlow',
  'portfolio.positions',
] as const;

/** Human-readable display titles for planned capabilities (single source). */
export const CAPABILITY_TITLES: Record<string, string> = {
  'company.profile': 'Company Profile',
  'market.quote': 'Price Momentum',
  'market.kline': 'Price Trend',
  'company.valuation': 'Valuation',
  'company.financials': 'Financials',
  'company.earnings': 'Earnings',
  'company.ratings': 'Analyst Ratings',
  'research.news': 'News',
  'market.capitalFlow': 'Capital Flow',
  'portfolio.positions': 'Portfolio Position',
};

export interface PlannedCapability {
  capabilityId: string;
  /** True when the capability is registered and will be fetched. */
  available: boolean;
}

/**
 * Build the ordered plan for `symbol`. `symbol` is reserved for future
 * adaptive planning (e.g. market-specific capability selection); today the
 * order is identical for every symbol and only availability varies with the
 * registry.
 */
export function planCapabilities(
  symbol: string,
  registry: CapabilityRegistry
): PlannedCapability[] {
  void symbol;
  const registered = new Set(registry.list().map((cap) => cap.id));
  return RESEARCH_CAPABILITY_PLAN.map((capabilityId) => ({
    capabilityId,
    available: registered.has(capabilityId),
  }));
}

/**
 * Build the ordered plan for a strategy (V5). `strategyId` undefined keeps
 * the legacy fixed plan (`basePlan`, default `RESEARCH_CAPABILITY_PLAN`); a
 * strategy id resolves to that strategy's capability list, which is always a
 * subset of the comprehensive plan in canonical order.
 */
export function planForStrategy(
  strategyId: StrategyId | undefined,
  registry: CapabilityRegistry,
  basePlan: readonly string[] = RESEARCH_CAPABILITY_PLAN
): PlannedCapability[] {
  const ids = strategyCapabilityIds(strategyId, basePlan);
  const registered = new Set(registry.list().map((cap) => cap.id));
  return ids.map((capabilityId) => ({
    capabilityId,
    available: registered.has(capabilityId),
  }));
}

/**
 * Runner-style input for a planned capability. Most capabilities are
 * symbol-scoped; `research.events` (finance calendar) requires a structured
 * query instead of a bare symbol.
 */
export function buildCapabilityInput(capabilityId: string, symbol: string): unknown {
  if (capabilityId === 'research.events') {
    return { eventType: 'financial', symbols: [symbol] };
  }
  return { symbol };
}
