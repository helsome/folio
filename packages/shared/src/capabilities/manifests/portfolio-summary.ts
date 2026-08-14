import { Type } from '@sinclair/typebox';
import type { Portfolio } from '@finagent/core';
import type { FinanceCapability } from '@finagent/core';
import { defineCapability } from '../define.ts';
import type { CapabilityFetchers } from '../fetchers.ts';
import { defaultCapabilityFetchers } from '../fetchers.ts';

export function createPortfolioSummaryCapability(
  fetchers: CapabilityFetchers = defaultCapabilityFetchers
): FinanceCapability<Record<string, never>, Portfolio> {
  return defineCapability<Record<string, never>, Portfolio>({
    id: 'portfolio.summary',
    name: 'Portfolio',
    toolName: 'get_portfolio',
    category: 'portfolio',
    riskLevel: 'read',
    auth: 'account',
    description:
      'Get the current portfolio: total value, cash balance, and each holding with cost, market value and unrealized P&L. Use this whenever the user asks about their positions, cash, or overall portfolio value.',
    inputSchema: Type.Object({}),
    async execute(_input, ctx) {
      const portfolio = await fetchers.getPortfolio();
      return {
        data: portfolio,
        provenance: { provider: 'longbridge', fetchedAt: (ctx?.now ?? Date.now)(), stale: false },
        summary: formatPortfolio(portfolio),
      };
    },
  });
}

function formatPortfolio(portfolio: Portfolio) {
  const positionsText = portfolio.positions.length > 0
    ? portfolio.positions.map((position) => {
        const pnlStr = position.unrealizedPnL >= 0
          ? `+$${position.unrealizedPnL.toFixed(2)} (+${position.unrealizedPnLPercent.toFixed(2)}%)`
          : `$${position.unrealizedPnL.toFixed(2)} (${position.unrealizedPnLPercent.toFixed(2)}%)`;
        return [
          `  ${position.symbol}: ${position.quantity} shares @ $${position.avgCost.toFixed(2)}`,
          `     Current: $${position.lastPrice.toFixed(2)} | Value: $${position.marketValue.toFixed(2)}`,
          `     P&L: ${pnlStr}`,
        ].join('\n');
      }).join('\n')
    : '  No positions';

  return [
    'Portfolio Summary',
    '-----------------',
    `Total Value: $${portfolio.totalValue.toFixed(2)}`,
    `Cash: $${portfolio.cash.toFixed(2)}`,
    '',
    `Positions (${portfolio.positions.length})`,
    positionsText,
  ].join('\n');
}
