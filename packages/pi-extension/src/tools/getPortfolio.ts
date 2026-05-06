import { Type } from '@sinclair/typebox';
import { getPortfolio } from '@finagent/longbridge-tools';
import { validateParams } from './validation.ts';

const getPortfolioParameters = Type.Object({});

export const getPortfolioTool = {
  name: 'get_portfolio',
  label: 'Get Portfolio',
  description: 'Get current portfolio holdings, cash balance, and total value.',
  parameters: getPortfolioParameters,

  async execute(
    toolCallId: string,
    rawParams: Record<string, never>,
    signal: AbortSignal
  ) {
    validateParams<Record<string, never>>(getPortfolioParameters, rawParams);
    const portfolio = await getPortfolio();

    const positionsText = portfolio.positions.length > 0
      ? portfolio.positions.map((p) => {
          const pnlEmoji = p.unrealizedPnL >= 0 ? '📈' : '📉';
          const pnlStr = p.unrealizedPnL >= 0
            ? `+$${p.unrealizedPnL.toFixed(2)} (+${p.unrealizedPnLPercent.toFixed(2)}%)`
            : `$${p.unrealizedPnL.toFixed(2)} (${p.unrealizedPnLPercent.toFixed(2)}%)`;
          return [
            `  ${pnlEmoji} ${p.symbol}: ${p.quantity} shares @ $${p.avgCost.toFixed(2)}`,
            `     Current: $${p.lastPrice.toFixed(2)} | Value: $${p.marketValue.toFixed(2)}`,
            `     P&L: ${pnlStr}`,
          ].join('\n');
        }).join('\n')
      : '  No positions';

    const text = [
      `💼 Portfolio Summary`,
      `─────────────────────`,
      `Total Value: $${portfolio.totalValue.toFixed(2)}`,
      `Cash: $${portfolio.cash.toFixed(2)}`,
      ``,
      `📊 Positions (${portfolio.positions.length})`,
      positionsText,
    ].join('\n');

    return {
      content: [{
        type: 'text' as const,
        text,
      }],
    };
  },
};
