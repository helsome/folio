import type { NamespaceResource } from '../keys.ts';

/** Compare slice (spec §32) — metric display names keyed by stable metric id. */
export const compare = {
  metric: 'Metric',
  title: 'Compare symbols (2–4)',
  symbolPlaceholder: 'Symbol, e.g. AAPL.US',
  addTwo: 'Add at least two symbols to build a comparison.',
  agentContext: 'The agent context carries these symbols while the Compare workspace is focused.',
  unavailable: 'Comparison is unavailable in this environment.',
  metrics: {
    price: 'Price',
    marketCap: 'Market Cap',
    pe: 'PE',
    pb: 'PB',
    revenueGrowth: 'Revenue Growth',
    grossMargin: 'Gross Margin',
    roe: 'ROE',
    dividendYield: 'Dividend Yield',
    return1m: '1M Return',
    return3m: '3M Return',
    return1y: '1Y Return',
    analystRating: 'Analyst Rating',
    momentum: 'Momentum',
  },
} satisfies NamespaceResource;
