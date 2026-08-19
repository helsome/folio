/**
 * User-facing labels for capability ids. Capability ids are domain
 * identifiers (e.g. `market.quote`) and must never leak into normal UI
 * (V9 §26–27, §125). This maps ids to i18n keys under `research.capabilities.*`.
 * Unknown ids fall back to a stable neutral key rather than the raw id.
 */

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

/** i18n key for a capability id's user-facing label, or null when unknown. */
export function capabilityLabelKey(capabilityId: string): string | null {
  return CAPABILITY_LABEL_KEY[capabilityId] ?? null;
}

/** True when the id has a curated label (used to keep fallbacks honest). */
export function hasCapabilityLabel(capabilityId: string): boolean {
  return capabilityId in CAPABILITY_LABEL_KEY;
}
