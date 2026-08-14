import { Type } from '@sinclair/typebox';
import type { StaticInfo } from '@finagent/core';
import type { FinanceCapability } from '@finagent/core';
import { defineCapability } from '../define.ts';
import { normalizeSymbol } from '../validate.ts';
import type { CapabilityFetchers } from '../fetchers.ts';
import { defaultCapabilityFetchers } from '../fetchers.ts';

export function createCompanyProfileCapability(
  fetchers: CapabilityFetchers = defaultCapabilityFetchers
): FinanceCapability<{ symbol: string }, StaticInfo> {
  return defineCapability<{ symbol: string }, StaticInfo>({
    id: 'company.profile',
    name: 'Company Profile',
    toolName: 'get_company_profile',
    category: 'company',
    riskLevel: 'read',
    auth: 'public',
    description:
      'Get static reference data for a company: name, exchange, currency, lot size, share counts, EPS and dividend. Use this to establish basic facts about a security before deeper analysis.',
    inputSchema: Type.Object({
      symbol: Type.String({ description: 'Stock symbol, e.g. AAPL.US', examples: ['AAPL.US'] }),
    }),
    async execute(input, ctx) {
      const symbol = normalizeSymbol(input.symbol);
      const info = await fetchers.getStaticInfo(symbol);
      return {
        data: info,
        provenance: { provider: 'longbridge', fetchedAt: (ctx?.now ?? Date.now)(), stale: false },
        summary: formatStaticInfo(info),
      };
    },
  });
}

function formatStaticInfo(info: StaticInfo) {
  const lines = [
    'Company Profile',
    '-----------------',
    `${info.symbol}: ${info.name}`,
  ];
  if (info.exchange) lines.push(`Exchange: ${info.exchange}`);
  if (info.currency) lines.push(`Currency: ${info.currency}`);
  if (info.lotSize !== undefined) lines.push(`Lot size: ${info.lotSize}`);
  if (info.totalShares !== undefined) lines.push(`Total shares: ${info.totalShares.toLocaleString()}`);
  if (info.circulatingShares !== undefined) lines.push(`Circulating shares: ${info.circulatingShares.toLocaleString()}`);
  if (info.eps !== undefined) lines.push(`EPS: ${info.eps}`);
  if (info.epsTtm !== undefined) lines.push(`EPS (TTM): ${info.epsTtm}`);
  if (info.bps !== undefined) lines.push(`Book value/share: ${info.bps}`);
  if (info.dividend !== undefined) lines.push(`Dividend/share: ${info.dividend}`);
  return lines.join('\n');
}
