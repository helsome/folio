import { Type } from '@sinclair/typebox';
import type { MarketStatus } from '@finagent/core';
import type { FinanceCapability } from '@finagent/core';
import { defineCapability } from '../define.ts';
import type { CapabilityFetchers } from '../fetchers.ts';
import { defaultCapabilityFetchers } from '../fetchers.ts';

export function createMarketStatusCapability(
  fetchers: CapabilityFetchers = defaultCapabilityFetchers
): FinanceCapability<Record<string, never>, MarketStatus[]> {
  return defineCapability<Record<string, never>, MarketStatus[]>({
    id: 'market.status',
    name: 'Market Status',
    toolName: 'get_market_status',
    category: 'market',
    riskLevel: 'read',
    auth: 'public',
    description:
      'Get the open/closed trading-session status for each exchange. Use this to check whether a market is currently trading before reasoning about quotes or placing orders.',
    inputSchema: Type.Object({}),
    async execute(_input, ctx) {
      const statuses = await fetchers.getMarketStatus();
      return {
        data: statuses,
        provenance: {
          provider: 'longbridge',
          fetchedAt: (ctx?.now ?? Date.now)(),
          stale: false,
        },
        summary: formatMarketStatus(statuses),
      };
    },
  });
}

function formatMarketStatus(statuses: MarketStatus[]) {
  if (statuses.length === 0) {
    return 'Market Status\n-----------------\nNo exchange status available.';
  }
  return [
    'Market Status',
    '-----------------',
    ...statuses.map((entry) => `${entry.market}: ${entry.status}`),
  ].join('\n');
}
