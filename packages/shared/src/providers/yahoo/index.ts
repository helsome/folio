/**
 * Yahoo Finance — no-key US market-data adapter.
 *
 * Unofficial chart endpoint (no API key). Quotes are delayed. Yahoo's terms
 * restrict this kind of access to personal use, and the endpoint can change
 * or rate-limit without notice. See `docs/yahoo-finance.md`.
 */
export {
  YahooChartFinancialDataProvider,
  YAHOO_PROVIDER_ID,
  YAHOO_PROVIDER_NAME,
} from './adapter.ts'
export type { YahooConfig } from './adapter.ts'
