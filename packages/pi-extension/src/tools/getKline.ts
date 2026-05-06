import { Type } from '@sinclair/typebox';
import { getKline, getIntraday } from '@finagent/longbridge-tools';
import { normalizeSymbol, validateParams } from './validation.ts';

const PeriodEnum = Type.Union([
  Type.Literal('1m'),
  Type.Literal('5m'),
  Type.Literal('15m'),
  Type.Literal('1h'),
  Type.Literal('1d'),
  Type.Literal('1w'),
]);

const getKlineParameters = Type.Object({
  symbol: Type.String({
    description: 'Stock symbol (e.g., AAPL.US)',
  }),
  period: Type.Optional(Type.Union([PeriodEnum, Type.String()])),
  limit: Type.Optional(Type.Number({ default: 100 })),
});

const getIntradayParameters = Type.Object({
  symbol: Type.String({
    description: 'Stock symbol (e.g., AAPL.US)',
  }),
});

export const getKlineTool = {
  name: 'get_kline',
  label: 'Get K-Line Chart',
  description: 'Get historical K-line (candlestick) data for a symbol.',
  parameters: getKlineParameters,

  async execute(
    toolCallId: string,
    rawParams: { symbol: string; period?: string; limit?: number },
    signal: AbortSignal
  ) {
    const params = validateParams<{ symbol: string; period?: string; limit?: number }>(
      getKlineParameters,
      rawParams
    );
    const symbol = normalizeSymbol(params.symbol);
    const klines = await getKline({
      symbol,
      period: (params.period as '1d' | '1w' | '1m') || '1d',
      limit: params.limit || 100,
    });

    const recent = klines.slice(-5);
    const text = [
      `📊 ${symbol} K-Line (${params.period || '1d'})`,
      `─────────────────────`,
      ...recent.map((k) => {
        const date = new Date(k.timestamp * 1000).toLocaleDateString();
        return `${date}: O$${k.open.toFixed(2)} H$${k.high.toFixed(2)} L$${k.low.toFixed(2)} C$${k.close.toFixed(2)} V${k.volume}`;
      }),
    ].join('\n');

    return {
      content: [{
        type: 'text' as const,
        text,
      }],
    };
  },
};

export const getIntradayTool = {
  name: 'get_intraday',
  label: 'Get Intraday Data',
  description: 'Get intraday price data for a symbol.',
  parameters: getIntradayParameters,

  async execute(
    toolCallId: string,
    rawParams: { symbol: string },
    signal: AbortSignal
  ) {
    const params = validateParams<{ symbol: string }>(getIntradayParameters, rawParams);
    const symbol = normalizeSymbol(params.symbol);
    const data = await getIntraday(symbol);
    const recent = data.slice(-10);

    const text = [
      `📈 ${symbol} Intraday`,
      `─────────────────────`,
      ...recent.map((d) => {
        const time = new Date(d.timestamp * 1000).toLocaleTimeString();
        return `${time}: $${d.price.toFixed(2)} (V: ${d.volume})`;
      }),
    ].join('\n');

    return {
      content: [{
        type: 'text' as const,
        text,
      }],
    };
  },
};
