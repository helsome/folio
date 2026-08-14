# Capability manifests

Wave-1 capabilities live in the per-capability files aggregated by `index.ts`
(`createPhaseOneCapabilities`). Wave-2 (Longbridge expansion) lives in
`phase-two.ts` and is aggregated by `createPhaseTwoCapabilities(fetchers?)`.

Each manifest is a factory: `createXxxCapability(fetchers?: CapabilityFetchers)`.
Passing no argument builds against the real Longbridge fetchers
(`defaultCapabilityFetchers`); tests and the local backend inject a stubbed or
cached implementation.

## Phase 2 — Longbridge capability expansion

| Capability id | toolName | Factory | Fetcher (CLI command) | Fixture |
|---|---|---|---|---|
| `market.depth` | `get_market_depth` | `createMarketDepthCapability` | `getDepth` (`depth`) | `depth.json` |
| `market.trades` | `get_trades` | `createMarketTradesCapability` | `getTrades` (`trades`) | `trades.json` |
| `market.capitalFlow` | `get_capital_flow` | `createMarketCapitalFlowCapability` | `getCapitalFlow` (`capital`) | `capital.json` |
| `market.sentiment` | `get_market_sentiment` | `createMarketSentimentCapability` | `getMarketTemperature` (`market-temp`) | `market-temp.json` |
| `company.financials` | `get_financials` | `createCompanyFinancialsCapability` | `getFinancialReport` (`financial-report`) | `financial-report.json` |
| `company.ratings` | `get_ratings` | `createCompanyRatingsCapability` | `getInstitutionRating` (`institution-rating`) | `institution-rating.json` |
| `company.dividends` | `get_dividends` | `createCompanyDividendsCapability` | `getDividends` (`dividend`) | `dividend.json` |
| `company.earnings` | `get_earnings` | `createCompanyEarningsCapability` | `getEpsForecasts` (`forecast-eps`) | `forecast-eps.json` |
| `research.events` | `get_calendar_events` | `createResearchEventsCapability` | `getCalendarEvents` (`finance-calendar`) | `finance-calendar.json`, `finance-calendar-events.json` |
| `portfolio.positions` | `get_positions` | `createPortfolioPositionsCapability` | `getAccountPositions` (`positions`) | `positions.json` |
| `portfolio.assets` | `get_assets` | `createPortfolioAssetsCapability` | `getAssets` (`assets`) | `assets.json` |
| `portfolio.cashFlow` | `get_cash_flow` | `createPortfolioCashFlowCapability` | `getCashFlow` (`cash-flow`) | `cash-flow.json` |

Fixtures are real `longbridge --format json` output under
`packages/longbridge-tools/src/testing/fixtures/` (see that package's
`testing/fixtures/README.md`). `finance-calendar-events.json` is a fresh capture
with a symbol filter so the event-parsing path is exercised.

Auth: `public` for market/company/research capabilities, `account` for the three
`portfolio.*` capabilities. All phase-2 capabilities are `riskLevel: 'read'`.
