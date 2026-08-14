/**
 * Longbridge output types.
 *
 * Provider-neutral LONG-TAIL market-data output types live in `@finagent/core`
 * (`market-data.ts`) and are re-exported below so existing consumers keep
 * compiling unchanged. Portfolio-shaped output types moved to
 * `@finagent/core` (`account.ts`); raw portfolio wire shapes live in
 * `normalizer.ts`.
 *
 * Timestamps are epoch SECONDS unless noted otherwise, matching the existing
 * core convention (`Quote.timestamp`, `Kline.timestamp`, `NewsItem.timestamp`).
 * Numeric strings from the CLI (`"224.120"`) are normalized to `number`; date
 * strings (`"2026.06.04"`) and numeric-string epoch seconds (`"1772064000"`)
 * are normalized to epoch seconds by the parsers.
 */

// Provider-neutral long-tail market-data types (relocated to @finagent/core).
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
} from '@finagent/core/market-data';

/**
 * Portfolio-shaped output types have moved to `@finagent/core` (`account.ts`):
 * `Holding`, `PortfolioAccount`, `PortfolioSnapshot`, `AccountAssets`, and
 * `CashFlowRecord`. Raw CLI wire shapes live in `normalizer.ts`.
 */
