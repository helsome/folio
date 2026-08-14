/**
 * Provider-neutral market-data output types (V4).
 *
 * These are the LONG-TAIL (phase-2) shapes providers normalize raw vendor
 * output into — market microstructure, financial statements, ratings,
 * dividends, EPS forecasts, and finance-calendar events. Providers map their
 * raw vendor output into these neutral shapes; research/agent/UI layers
 * consume ONLY these shapes, never vendor-specific fields (spec §4).
 *
 * Timestamps are epoch SECONDS unless noted otherwise, matching the existing
 * core convention (`Quote.timestamp`, `Kline.timestamp`, `NewsItem.timestamp`).
 * Numeric strings from a vendor CLI (`"224.120"`) are normalized to `number`;
 * date strings (`"2026.06.04"`) and numeric-string epoch seconds
 * (`"1772064000"`) are normalized to epoch seconds by the parsers.
 */

/** One price level in the order book ladder. */
export interface DepthLevel {
  /** 1-based position in the ladder. */
  position: number;
  price: number;
  volume: number;
  orderNum: number;
}

/** Level 2 order book depth (bid/ask ladder). */
export interface Depth {
  symbol: string;
  bids: DepthLevel[];
  asks: DepthLevel[];
}

/** One tick-by-tick trade. */
export interface TradeTick {
  /** Epoch seconds of the trade. */
  timestamp: number;
  price: number;
  volume: number;
  /** Trade direction: `Up`, `Down`, or `Neutral`. */
  direction: string;
  /** Exchange trade-type code (e.g. `I`). */
  type: string;
}

/** One side (inflow/outflow) of the intraday capital distribution. */
export interface CapitalFlowSide {
  large: number;
  medium: number;
  small: number;
}

/** Intraday capital-flow distribution snapshot for a symbol. */
export interface CapitalFlow {
  symbol: string;
  /** Epoch seconds of the snapshot. */
  timestamp: number;
  capitalIn: CapitalFlowSide;
  capitalOut: CapitalFlowSide;
}

/** Market sentiment temperature index snapshot. */
export interface MarketTemperature {
  /** Market code: `US`, `HK`, `CN`, or `SG`. */
  market: string;
  /** 0–100 temperature score (higher = more bullish). */
  temperature: number;
  /** Human-readable temperature description. */
  description: string;
  /** 0–100 valuation score. */
  valuation: number;
  /** 0–100 sentiment score. */
  sentiment: number;
}

/** One fiscal-period value inside a financial report account. */
export interface FinancialReportValue {
  /** Epoch seconds of the fiscal period end. */
  fpEnd: number;
  /** Display period, e.g. `Q1 2027`. */
  period: string;
  year: number;
  value: number;
  ratio?: string;
  yoy?: string;
}

/** One named metric (account) within a financial report indicator. */
export interface FinancialReportAccount {
  /** Stable metric code, e.g. `TotalAssets`. */
  field: string;
  /** Display name, e.g. `总资产(USD)`. */
  name: string;
  rankingCode?: string;
  industryRanking?: string;
  percent?: boolean;
  tip?: string;
  values: FinancialReportValue[];
}

/** One indicator group (e.g. the Assets section of the balance sheet). */
export interface FinancialReportIndicator {
  title: string;
  shortTitle?: string;
  currency?: string;
  hasYoy?: boolean;
  periods?: string[];
  accounts: FinancialReportAccount[];
}

/** A single financial statement (income, balance sheet, or cash flow). */
export interface FinancialStatement {
  indicators: FinancialReportIndicator[];
}

/** Financial statements (IS/BS/CF) for a symbol. */
export interface FinancialReport {
  symbol: string;
  /** Period code the report was generated for (e.g. `qf`). */
  report: string;
  statements: {
    IS?: FinancialStatement;
    BS?: FinancialStatement;
    CF?: FinancialStatement;
  };
}

/** A rating distribution across a cohort of analysts/institutions. */
export interface RatingDistribution {
  buy: number;
  hold: number;
  sell: number;
  strongBuy?: number;
  noOpinion?: number;
  over?: number;
  under?: number;
  total: number;
}

/** Institution rating overview and target-price consensus. */
export interface InstitutionRating {
  symbol: string;
  /** Consensus recommendation, e.g. `strong_buy`, `buy`, `hold`, `sell`. */
  recommend: string;
  /** Consensus/average target price. */
  target?: number;
  /** Epoch seconds of the last rating update. */
  updatedAt?: number;
  /** Sell-side analyst breakdown. */
  analyst?: {
    distribution: RatingDistribution;
    industryName?: string;
    industryRank?: number;
    industryMean?: number;
    industryMedian?: number;
    industryTotal?: number;
    highestTarget?: number;
    lowestTarget?: number;
    prevClose?: number;
  };
  /** Institutional rating summary. */
  institutional?: {
    distribution: RatingDistribution;
    currency?: string;
    change?: number;
  };
}

/** One dividend record from the dividend history. */
export interface DividendRecord {
  /** Longbridge record id. */
  id: string;
  /** Human-readable description, e.g. `每股派息 0.25 USD`. */
  description: string;
  /** Epoch seconds of the ex-dividend date. */
  exDate: number;
  /** Epoch seconds of the payment date, when known. */
  paymentDate?: number;
  /** Epoch seconds of the record date, when known. */
  recordDate?: number;
  counterId?: string;
}

/** One EPS forecast / analyst consensus estimate. */
export interface EpsForecast {
  /** Epoch seconds of the forecast period end. */
  endDate: number;
  /** Epoch seconds of the forecast period start. */
  startDate: number;
  epsMean: number;
  epsMedian?: number;
  epsHighest?: number;
  epsLowest?: number;
  institutionUp?: number;
  institutionDown?: number;
  institutionTotal?: number;
}

/** A key/value data pair attached to a calendar event. */
export interface CalendarEventData {
  /** e.g. `estimate_eps`, `actual_revenue`, `ex-dividend`. */
  type: string;
  /** Display value. */
  value: string;
  /** Raw numeric value, when available. */
  valueRaw?: string;
}

/** A single finance-calendar event. */
export interface CalendarEvent {
  /** Longbridge event id. */
  id: string;
  /** Epoch seconds of the event. */
  date: number;
  /** Event type: `financial`, `report`, `dividend`, `ipo`, `macrodata`, or `closed`. */
  type: string;
  /** Activity subtype, e.g. `ex-dividend`. */
  activityType?: string;
  /** Best-effort symbol in CODE.MARKET form (empty when not available). */
  symbol: string;
  /** Raw Longbridge counter id, e.g. `ST/US/NVDA`. */
  counterId?: string;
  /** Company display name. */
  name?: string;
  market?: string;
  currency?: string;
  /** Human-readable event description. */
  content?: string;
  /** Local date string, e.g. `2026-05-20`. */
  localDate?: string;
  data?: CalendarEventData[];
}
