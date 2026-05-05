import { Type } from '@sinclair/typebox';
import { getQuote } from '@finagent/longbridge-tools';

export const getQuoteTool = {
  name: 'get_quote',
  label: 'Get Quote',
  description: 'Get real-time stock quote for a given symbol. Returns price, change, volume, and other quote data.',
  parameters: Type.Object({
    symbol: Type.String({
      description: 'Stock symbol in format: AAPL.US, TSLA.US, 0700.HK, 600519.SH',
      examples: ['AAPL.US', 'TSLA.US', '0700.HK'],
    }),
  }),

  async execute(
    toolCallId: string,
    params: { symbol: string },
    signal: AbortSignal
  ) {
    const quote = await getQuote(params.symbol);

    const changeEmoji = quote.change >= 0 ? '📈' : '📉';
    const changeStr = quote.change >= 0
      ? `+${quote.change.toFixed(2)} (+${quote.changePercent.toFixed(2)}%)`
      : `${quote.change.toFixed(2)} (${quote.changePercent.toFixed(2)}%)`;

    const text = [
      `${changeEmoji} ${quote.symbol}: $${quote.lastPrice.toFixed(2)}`,
      `Change: ${changeStr}`,
      `Volume: ${quote.volume.toLocaleString()}`,
      `High: $${quote.high.toFixed(2)} | Low: $${quote.low.toFixed(2)}`,
      `Open: $${quote.open.toFixed(2)} | Prev Close: $${quote.prevClose.toFixed(2)}`,
    ].join('\n');

    return {
      content: [{
        type: 'text' as const,
        text,
      }],
    };
  },
};