import type { FinanceCapability } from '@finagent/core';
import type { CapabilityFetchers } from '../fetchers.ts';
import { defaultCapabilityFetchers } from '../fetchers.ts';
import { createMarketQuoteCapability } from './market-quote.ts';
import { createMarketKlineCapability } from './market-kline.ts';
import { createMarketIntradayCapability } from './market-intraday.ts';
import { createMarketStatusCapability } from './market-status.ts';
import { createCompanyProfileCapability } from './company-profile.ts';
import { createCompanyValuationCapability } from './company-valuation.ts';
import { createResearchNewsCapability } from './research-news.ts';
import { createPortfolioSummaryCapability } from './portfolio-summary.ts';

/**
 * The eight wave-1 capabilities. Each manifest is a factory so tests and the
 * local backend can inject stubbed/cached fetchers; production builds from the
 * default (real Longbridge) fetchers.
 */
export function createPhaseOneCapabilities(
  fetchers: CapabilityFetchers = defaultCapabilityFetchers
): FinanceCapability[] {
  return [
    createMarketQuoteCapability(fetchers),
    createMarketKlineCapability(fetchers),
    createMarketIntradayCapability(fetchers),
    createMarketStatusCapability(fetchers),
    createCompanyProfileCapability(fetchers),
    createCompanyValuationCapability(fetchers),
    createResearchNewsCapability(fetchers),
    createPortfolioSummaryCapability(fetchers),
  ];
}

export const phaseOneCapabilities = createPhaseOneCapabilities();
