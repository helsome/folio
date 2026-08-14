import { Type } from '@sinclair/typebox';
import type { NewsItem } from '@finagent/core';
import type { FinanceCapability } from '@finagent/core';
import { defineCapability } from '../define.ts';
import { normalizeSymbol } from '../validate.ts';
import type { CapabilityFetchers } from '../fetchers.ts';
import { defaultCapabilityFetchers } from '../fetchers.ts';

export function createResearchNewsCapability(
  fetchers: CapabilityFetchers = defaultCapabilityFetchers
): FinanceCapability<{ symbol: string }, NewsItem[]> {
  return defineCapability<{ symbol: string }, NewsItem[]>({
    id: 'research.news',
    name: 'News',
    toolName: 'get_news',
    category: 'research',
    riskLevel: 'read',
    auth: 'public',
    description:
      'Get the latest news headlines for a symbol. Use this to explain recent price moves or to surface catalysts relevant to an investment decision.',
    inputSchema: Type.Object({
      symbol: Type.String({ description: 'Stock symbol, e.g. AAPL.US', examples: ['AAPL.US'] }),
    }),
    async execute(input, ctx) {
      const symbol = normalizeSymbol(input.symbol);
      const news = await fetchers.getNews(symbol);
      return {
        data: news,
        provenance: {
          provider: 'longbridge',
          fetchedAt: (ctx?.now ?? Date.now)(),
          marketTime: news[0]?.timestamp,
          stale: false,
        },
        summary: formatNews(symbol, news),
      };
    },
  });
}

function formatNews(symbol: string, news: NewsItem[]) {
  if (news.length === 0) {
    return `${symbol} News\n-----------------\nNo recent news.`;
  }
  return [
    `${symbol} News`,
    '-----------------',
    ...news.slice(0, 10).map((item) => {
      const time = new Date(item.timestamp * 1000).toLocaleString();
      return `- ${item.title} (${time})`;
    }),
  ].join('\n');
}
