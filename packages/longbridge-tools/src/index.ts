export { executeLongBridge } from './executor.ts';
export type { ExecutorOptions } from './executor.ts';

export { getLongBridgeStatus } from './status.ts';
export type { LongBridgeStatus, LongBridgeStatusValue } from './status.ts';

export { validateSymbol, validateSymbolOrThrow } from './validator.ts';

export { LongBridgeError, isLongBridgeError } from './errors.ts';
export type { ErrorCode } from './errors.ts';

export {
  parseQuoteResponse,
  parsePortfolioResponse,
  parseKlineResponse,
  parseIntradayResponse,
  parseStaticInfoResponse,
  parseCalcIndexResponse,
  parseMarketStatusResponse,
  parseNewsResponse,
} from './parser.ts';

export { getStaticInfo, getCalcIndex, getMarketStatus, getNews } from './tools/reference.ts';
export type { GetCalcIndexOptions, GetNewsOptions, GetStaticInfoOptions } from './tools/reference.ts';

export { getQuote, getQuotes } from './tools/quote.ts';
export type { GetQuoteOptions } from './tools/quote.ts';

export { getKline, getIntraday } from './tools/kline.ts';
export type { GetKlineOptions, GetIntradayOptions } from './tools/kline.ts';

export { getPortfolio, getPositions, getCash } from './tools/portfolio.ts';

export type { Quote, Portfolio, Position, Kline, IntradayData } from '@finagent/core';
