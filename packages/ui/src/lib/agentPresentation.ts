/**
 * Shared Agent Presentation layer (V9.1 §1).
 *
 * ONE mapping serves every surface that shows agent execution:
 *   - AgentPanel ToolActivity (tool names)
 *   - Trace Inspector timeline (tool names + statuses)
 *   - Research run progress + evidence (capability ids)
 *
 * Raw ids (get_quote / market.quote) never become the default label; they are
 * demoted to technical details in expanded views. This module is the single
 * source of truth — do NOT maintain a second label dictionary elsewhere.
 */

export type AgentToolCategory = 'market' | 'company' | 'research' | 'portfolio' | 'analysis' | 'other';

/** Agent tool name → i18n key under `agent.tool.names.*` (e.g. get_quote). */
const TOOL_LABEL_KEY: Readonly<Record<string, string>> = {
  get_quote: 'agent.tool.names.getQuote',
  get_portfolio: 'agent.tool.names.getPortfolio',
  get_financials: 'agent.tool.names.getFinancials',
  get_valuation: 'agent.tool.names.getValuation',
  get_news: 'agent.tool.names.getNews',
  get_kline: 'agent.tool.names.getKline',
  get_earnings: 'agent.tool.names.getEarnings',
  get_profile: 'agent.tool.names.getProfile',
  analyze: 'agent.tool.names.analyze',
};

/** Tool name → category (used for grouping/coloring in traces). */
const TOOL_CATEGORY: Readonly<Record<string, AgentToolCategory>> = {
  get_quote: 'market',
  get_kline: 'market',
  get_intraday: 'market',
  get_depth: 'market',
  get_trades: 'market',
  get_portfolio: 'portfolio',
  get_financials: 'company',
  get_valuation: 'company',
  get_earnings: 'company',
  get_profile: 'company',
  get_ratings: 'company',
  get_news: 'research',
  get_events: 'research',
  analyze: 'analysis',
};

/** Capability id → i18n key under `research.capabilities.*` (e.g. market.quote). */
const CAPABILITY_LABEL_KEY: Readonly<Record<string, string>> = {
  'market.quote': 'research.capabilities.marketQuote',
  'market.kline': 'research.capabilities.marketKline',
  'market.intraday': 'research.capabilities.marketIntraday',
  'market.trades': 'research.capabilities.marketTrades',
  'market.depth': 'research.capabilities.marketDepth',
  'market.status': 'research.capabilities.marketStatus',
  'market.capitalFlow': 'research.capabilities.marketCapitalFlow',
  'company.profile': 'research.capabilities.companyProfile',
  'company.valuation': 'research.capabilities.companyValuation',
  'company.financials': 'research.capabilities.companyFinancials',
  'company.earnings': 'research.capabilities.companyEarnings',
  'company.dividends': 'research.capabilities.companyDividends',
  'company.ratings': 'research.capabilities.companyRatings',
  'research.news': 'research.capabilities.researchNews',
  'research.events': 'research.capabilities.researchEvents',
  'portfolio.summary': 'research.capabilities.portfolioSummary',
};

const NEUTRAL_TOOL_KEY = 'agent.tool.names.other';
const NEUTRAL_CAPABILITY_KEY = 'agent.tool.names.other';

/** i18n key for a tool name's user-facing label; falls back to a neutral key. */
export function semanticToolLabelKey(toolName: string): string {
  return TOOL_LABEL_KEY[toolName] ?? NEUTRAL_TOOL_KEY;
}

/** i18n key for a capability id's user-facing label; neutral fallback. */
export function semanticCapabilityLabelKey(capabilityId: string): string {
  return CAPABILITY_LABEL_KEY[capabilityId] ?? NEUTRAL_CAPABILITY_KEY;
}

/** True when a curated label exists (keeps fallbacks honest). */
export function hasSemanticToolLabel(toolName: string): boolean {
  return toolName in TOOL_LABEL_KEY;
}

export function semanticToolCategory(toolName: string): AgentToolCategory {
  return TOOL_CATEGORY[toolName] ?? 'other';
}

/** i18n key for a tool/step status (running / success / error). */
export function semanticStatusLabelKey(status: 'running' | 'success' | 'error' | string): string {
  if (status === 'running') return 'agent.tool.statusRunning';
  if (status === 'error') return 'trace.status.error';
  return 'trace.status.success';
}

/** i18n key for a trace completeness level. */
export function semanticCompletenessLabelKey(completeness: 'complete' | 'partial' | 'minimal'): string {
  return `trace.completeness.${completeness}`;
}

/** i18n key for a context-source badge (Recorded / Evaluation Input / Live / Not recorded). */
export function semanticContextSourceLabelKey(
  source: 'recorded' | 'evaluation-input' | 'runtime' | 'live' | 'not-recorded'
): string {
  return `trace.contextSource.${source}`;
}

/** i18n key for a trace element source chip. */
export function semanticElementSourceLabelKey(source: string): string {
  return `trace.elementSource.${source}`;
}
