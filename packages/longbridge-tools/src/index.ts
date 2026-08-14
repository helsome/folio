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
  parseDepthResponse,
  parseTradesResponse,
  parseCapitalFlowResponse,
  parseMarketTemperatureResponse,
  parseFinancialReportResponse,
  parseInstitutionRatingResponse,
  parseDividendResponse,
  parseEpsForecastResponse,
  parseCalendarResponse,
  parsePositionsResponse,
  parseAssetsResponse,
  parseCashFlowResponse,
} from './parser.ts';

export {
  classifyPortfolioFailure,
  computeUnrealizedPnL,
  computeUnrealizedPnLPercent,
  isEmptySnapshot,
  isPartialSnapshot,
  normalizeAssets,
  normalizeCashFlow,
  normalizePortfolioSnapshot,
  normalizePositions,
  toEpochSeconds,
  toFiniteNumber,
} from './normalizer.ts';
export type {
  RawAssetsResponse,
  RawCashBalance,
  RawCashFlowRecord,
  RawCashInfo,
  RawMarketAccount,
  RawPortfolioHolding,
  RawPortfolioOverview,
  RawPortfolioResponse,
  RawPosition,
} from './normalizer.ts';

export { getStaticInfo, getCalcIndex, getMarketStatus, getNews } from './tools/reference.ts';
export type { GetCalcIndexOptions, GetNewsOptions, GetStaticInfoOptions } from './tools/reference.ts';

export { getQuote, getQuotes } from './tools/quote.ts';
export type { GetQuoteOptions } from './tools/quote.ts';

export { getKline, getIntraday } from './tools/kline.ts';
export type { GetKlineOptions, GetIntradayOptions } from './tools/kline.ts';
export { getPortfolio, getPositions, getCash } from './tools/portfolio.ts';

export { getDepth } from './tools/depth.ts';

export { getTrades } from './tools/trades.ts';

export { getCapitalFlow } from './tools/capital.ts';

export { getMarketTemperature } from './tools/market-temp.ts';

export { getFinancialReport } from './tools/financial-report.ts';
export type { FinancialReportKind } from './tools/financial-report.ts';

export { getInstitutionRating } from './tools/institution-rating.ts';

export { getDividends } from './tools/dividend.ts';

export { getEpsForecasts } from './tools/forecast-eps.ts';

export { getCalendarEvents } from './tools/calendar.ts';
export type { CalendarEventType, GetCalendarEventsOptions } from './tools/calendar.ts';

export { getAccountPositions } from './tools/positions.ts';

export { getAssets } from './tools/assets.ts';

export { getCashFlow } from './tools/cash-flow.ts';
export type { GetCashFlowOptions } from './tools/cash-flow.ts';

export type { Quote, Kline, IntradayData } from '@finagent/core';

export type {
  CalendarEvent,
  CalendarEventData,
  CapitalFlow,
  CapitalFlowSide,
  Depth,
  DepthLevel,
  DividendRecord,
  EpsForecast,
  FinancialReport,
  FinancialReportAccount,
  FinancialReportIndicator,
  FinancialReportValue,
  FinancialStatement,
  InstitutionRating,
  MarketTemperature,
  RatingDistribution,
  TradeTick,
} from './types.ts';
