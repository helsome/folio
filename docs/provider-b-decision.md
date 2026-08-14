# Provider B — Secondary Market-Data Provider Decision

Status: **RESEARCH ONLY** (no code changes). Decision for the minimal V4 Provider Platform
adapter that proves the router architecture (spec §12–13).

- Contract implemented against: `packages/core/src/provider.ts` (`FinancialDataProvider`,
  `ProviderResult`, `ProviderProvenance`, `ProviderCoverage`, `DEFAULT_MARKETS = US/HK/CN/SG`).
- Target capability slice: **`market.quote` + `market.kline` + `company.profile`** (market-data-only).
  No portfolio. `research.news` is optional for this adapter.

---

## 1. Recommendation (short version)

**Polygon.io (now rebranded "Massive") — US stocks, `quote + kline + profile`.**

Polygon is the **only** candidate whose license structure has an explicit, self-serve
commercial path: the "Massive for Businesses" Terms of Service grants the customer the right to
make data available to its "Authorized Users" and **"Edge Users"** (the end users of the
customer's product) — i.e., it contemplates exactly the desktop-app distribution Folio needs.
Every other candidate's free/self-serve tier is "personal use only" and forbids redistribution
outright (see §3). Under the spec §12 rule — *"a provider whose terms forbid redistribution is
disqualified no matter how good the API"* — Polygon is the only survivor.

The one hard caveat: Polygon's **free "Stocks Basic" tier is itself labeled "Individual use"** and
returns **end-of-day** (not real-time) data. That is acceptable for building and smoke-testing the
adapter (5 calls/min), but a commercial Folio ship requires a **Business plan** (real-time,
`Edge Users` right) — or a BYOK model where each end user's own license governs. This is
documented in §4 (risks) and must be surfaced in the Connections UI, not silently papered over.

---

## 2. Comparison matrix

Legend: ✅ good · ⚠️ partial / gated · ❌ disqualifying or missing. Every cell cites the
official vendor page where the claim is stated.

| Criterion | Polygon (Massive) | Alpha Vantage | Finnhub | Twelve Data | Tiingo | EODHD | Yahoo Finance |
|---|---|---|---|---|---|---|---|
| **API availability** (quote/kline/profile/news) | ✅ quote + aggs(kline) + ticker-details(profile) + news, one REST API — [docs](https://massive.com/docs/rest/stocks/overview) | ⚠️ quote+kline yes, but **intraday is now a Premium endpoint** — [docs](https://www.alphavantage.co/documentation/#intraday) | ✅ quote + candle + company profile + news — [docs](https://finnhub.io/docs/api) | ✅ quote + time_series + profile + news — [docs](https://twelvedata.com/docs/llms/market-data.md) | ⚠️ EOD/quote/iex real-time + fundamentals + news (newer product) — [docs](https://www.tiingo.com/documentation/news) | ✅ quote + EOD + intraday + profile + news, 45+ APIs — [docs](https://eodhd.com/financial-apis/) | ⚠️ quote/kline/profile/news via **unofficial scraping** (`yfinance`), no official API — [yfinance](https://github.com/ranaroussi/yfinance) |
| **Markets US/HK/CN/SG** | ❌ **US only** (locale `us`) — [ticker docs](https://massive.com/docs/rest/stocks/tickers/ticker-overview) | ⚠️ US + some global EOD; HK/CN/SG patchy — [docs](https://www.alphavantage.co/documentation/) | ⚠️ US strong; global via international endpoints, HK/CN/SG thin — [docs](https://finnhub.io/docs/api) | ⚠️ 70+ exchanges incl. HK/CN/SG **but only on paid plans** (free = US only) — [pricing](https://twelvedata.com/pricing) | ❌ US (IEX) only — [docs](https://www.tiingo.com/documentation/iex) | ✅ **70+ exchanges incl. US/HK/CN/SG** — [docs](https://eodhd.com/financial-apis/exchanges-api-list-of-tickers-and-trading-hours) | ⚠️ US + global via scraping; unofficial — [yfinance](https://github.com/ranaroussi/yfinance) |
| **Real-time vs delayed** | ⚠️ free = **EOD**; Starter $29 = 15-min delayed; real-time only on Advanced/Business — [pricing](https://massive.com/pricing) | ❌ real-time + 15-min delayed **premium only** — [docs](https://www.alphavantage.co/documentation/#intraday) | ✅ real-time US stocks on free tier — [docs](https://finnhub.io/docs/api/quote) | ⚠️ real-time US on free; other markets real-time on paid — [pricing](https://twelvedata.com/pricing) | ⚠️ real-time (IEX) US on free tier — [docs](https://www.tiingo.com/documentation/iex) | ⚠️ real-time (WebSocket) on paid; EOD/intraday on free — [docs](https://eodhd.com/financial-apis/new-real-time-data-api-websockets) | ⚠️ ~15-min delayed quotes via scraper, no guarantee — [yfinance](https://github.com/ranaroussi/yfinance) |
| **Fundamentals depth** | ⚠️ ticker details + financials on Business plans; thinner than Finnhub/EODHD — [ticker docs](https://massive.com/docs/rest/stocks/tickers/ticker-overview) | ✅ income/balance/cash-flow/overview — [docs](https://www.alphavantage.co/documentation/#fundamentals) | ✅ basic financials free, standard financials premium — [docs](https://finnhub.io/docs/api/financials) | ✅ income/balance/cash-flow/statistics/profile — [docs](https://twelvedata.com/docs/llms/fundamentals.md) | ✅ daily fundamentals + statements — [docs](https://www.tiingo.com/documentation/fundamentals) | ✅ deep fundamentals, 70+ exchanges — [docs](https://eodhd.com/financial-apis/stock-etfs-fundamental-data-feeds) | ⚠️ profile/statements via scraper — [yfinance](https://github.com/ranaroussi/yfinance) |
| **News availability** | ⚠️ `/v2/reference/news` exists (plan-gated) — [news](https://massive.com/docs/rest/stocks/news) | ✅ NEWS_SENTIMENT — [docs](https://www.alphavantage.co/documentation/#news-sentiment) | ✅ company news (free) + general news — [docs](https://finnhub.io/docs/api/company-news) | ✅ press_releases/news via fundamentals — [docs](https://twelvedata.com/docs/llms/fundamentals.md) | ✅ news API (newer product) — [docs](https://www.tiingo.com/documentation/news) | ✅ news + sentiment — [docs](https://eodhd.com/financial-apis/stock-market-financial-news-api) | ⚠️ news via scraper — [yfinance](https://github.com/ranaroussi/yfinance) |
| **Auth (API key, no OAuth)** | ✅ `apiKey` query param (single key) — [docs](https://massive.com/docs/llms.txt) | ✅ `apikey` query param — [docs](https://www.alphavantage.co/documentation/) | ✅ `token` param / `X-Finnhub-Token` header — [docs](https://finnhub.io/docs/api) | ✅ `apikey` query param — [docs](https://twelvedata.com/docs/llms/introduction.md) | ✅ `Authorization: Token` header — [docs](https://www.tiingo.com/documentation) | ✅ `api_token` query param — [docs](https://eodhd.com/financial-apis/) | ❌ none (scraper, no key) |
| **Rate limits (free tier)** | ⚠️ 5 API calls/min (unlimited on $29 Starter) — [pricing](https://massive.com/pricing) | ❌ 25 requests/**day** — [support](https://www.alphavantage.co/support/) | ✅ 60 calls/min (+ 30/sec hard cap) — [pricing](https://finnhub.io/pricing) · [ToS](https://finnhub.io/terms-of-service) | ⚠️ 8 credits/min + 800 req/day cap, **US only** — [pricing](https://twelvedata.com/pricing) | ⚠️ ~1000 req/day, 50 req/hr (free) — [docs](https://www.tiingo.com/documentation) | ⚠️ 20 API calls/day free — [pricing](https://eodhd.com/pricing) | ❌ rate-limited/degraded scraping, no SLA — [yfinance](https://github.com/ranaroussi/yfinance) |
| **License / redistribution** | ⚠️ free = "Individual use"; **Business ToS allows "Edge Users"** (see §3) — [terms](https://massive.com/legal/terms) | ❌ "premium… **for your personal use**. For commercial use, contact sales" — [docs](https://www.alphavantage.co/documentation/) | ❌ "strictly for **personal use**"; "not redistribute… without written approval"; "can't be used by any business even internally" — [ToS](https://finnhub.io/terms-of-service) | ❌ free = "**non-display usage only**"; "Free Tier data for commercial purposes" prohibited; redistribution needs paid add-on — [terms](https://twelvedata.com/terms) | ⚠️ free tier personal-use; **no self-serve business/redistribution tier documented** — [docs](https://www.tiingo.com/documentation) | ❌ "packages… intended for **personal use only** as commercial use requires" a quote — [license](https://eodhd.com/financial-apis/commercial-vs-personal-license-use) | ❌ **unofficial**; scraping/redistribution violates Yahoo ToS — [Yahoo ToS](https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html) |
| **Developer UX** | ✅ clean REST + JSON, official SDKs, coherent docs — [docs](https://massive.com/docs/llms.txt) | ⚠️ functional but dated, 25/day is brutal for dev — [docs](https://www.alphavantage.co/documentation/) | ✅ clean, but ToS disqualifies — [docs](https://finnhub.io/docs/api) | ✅ excellent (llms.txt, SDKs) but free tier is US-only/non-display — [docs](https://twelvedata.com/docs/llms.txt) | ⚠️ ok, SPA docs hard to scrape — [docs](https://www.tiingo.com/documentation) | ✅ broad, WordPress docs, good coverage — [docs](https://eodhd.com/financial-apis/) | ⚠️ no official docs, community lib only — [yfinance](https://github.com/ranaroussi/yfinance) |
| **Price** | ✅ free dev; $29 Starter; $79 Developer; $199 Advanced; Business (custom) — [pricing](https://massive.com/pricing) | ⚠️ free 25/day; Premium $49.99–$249/mo — [pricing](https://www.alphavantage.co/premium/) | ✅ free 60/min; Premium from $49.99/mo — [pricing](https://finnhub.io/pricing) | ⚠️ free; Business from $149/mo; distribution $1,099/mo — [pricing](https://twelvedata.com/pricing) | ✅ free; paid from ~$10/mo — [pricing](https://www.tiingo.com/about/pricing) | ⚠️ free 20/day; paid from ~$19.99/mo — [pricing](https://eodhd.com/pricing) | ✅ free (scraper) — [yfinance](https://github.com/ranaroussi/yfinance) |

---

## 3. Licensing analysis (the deciding criterion)

Spec §12 makes license/redistribution the **first** gate. Folio is a commercial desktop app that
displays market data in a UI; a provider whose terms say "personal use only" or "no redistribution"
on the tier our users would actually hold is disqualified regardless of API quality. Verbatim
clauses, with sources:

- **Finnhub** — *"You hereby agree to not redistribute or share access to data or derived results…
  without written approval. All plan listed on Finnhub website is strictly for personal use unless
  explicitly stated otherwise. Personal plan can't be used by any business even internally without a
  written approval."* → **DISQUALIFIED.** ([ToS](https://finnhub.io/terms-of-service))
- **Twelve Data** — Free/Basic is *"internal non-display usage only"*; ToS §2.3 *"(l) Use Free Tier
  data for commercial purposes"* is prohibited; *"Redistribution"* (defined) requires a
  *"Redistribution Rights Add-On or separate written agreement"* (Enterprise $1,099/mo); *"Business
  plans are required for any company… even if the data is only used internally."*
  → **DISQUALIFIED at free tier.** ([pricing](https://twelvedata.com/pricing) · [terms](https://twelvedata.com/terms))
- **EODHD** — *"The packages on the pricing page are intended for personal use only as commercial use
  requires a more thorough approach to licensing and data use."* Commercial use requires a sales
  quote (form) because *"we are required to report all commercial users of exchange data to the
  relevant exchanges."* → **DISQUALIFIED** (despite the best US/HK/CN/SG coverage).
  ([license](https://eodhd.com/financial-apis/commercial-vs-personal-license-use))
- **Alpha Vantage** — *"subscribe to a premium membership plan for your personal use. For commercial
  use, please contact sales."* → **DISQUALIFIED.** ([docs](https://www.alphavantage.co/documentation/))
- **Tiingo** — free tier is personal-use with no self-serve business/redistribution tier documented
  (unlike Polygon's explicit Business + "Edge Users" path); US-only. Exact ToS wording was not
  retrievable from a scrapeable page — re-verify the clause before any Tiingo fallback.
  ([docs](https://www.tiingo.com/documentation))
- **Yahoo Finance** — no official API; `yfinance` is a scraper. Yahoo's ToS bars automated access
  and redistribution of its content, so an adapter would rest on terms Folio cannot satisfy and a
  non-existent SLA. → **DISQUALIFIED.** ([Yahoo ToS](https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html) · [yfinance](https://github.com/ranaroussi/yfinance))

**Polygon/Massive** is structured differently, and that is why it wins:

- The terms hub splits into **"Massive for Individuals"** (personal, individual, non-business use of
  "Individual Use" products) and **"Massive for Businesses"** (individual, business, or commercial
  use of "Business Use" products). ([terms](https://massive.com/legal/terms))
- The **Business ToS** redistribution clause permits making Information available to *"Customer, its
  Authorized Users, or its Edge Users"* — where "Edge Users" are the end users of the customer's
  product. That is precisely Folio's distribution model. ([businesses ToS](https://massive.com/legal/businesses-terms-of-service))
- The **Individuals ToS** is unambiguous that *"if you are using the Services for business or
  commercial purposes, you may not use any of the Services labeled for individual or personal use"* —
  so the **free "Stocks Basic" tier is NOT a commercial license.** ([individuals ToS](https://massive.com/legal/individuals-terms-of-service))

Net licensing conclusion for the decision: **for the adapter/proof stage use the free "Individual
use" tier (dev only); for any commercial ship, Folio needs a Polygon Business plan (real-time +
`Edge Users`) — and that plan's price/terms are self-serve and documented, unlike the sales-gated
"personal use only" vendors above.** Attribution is incorporated by reference via Polygon's Market
Data Terms of Service (referenced from both ToS documents); treat "Powered by Polygon.io" display
attribution as required until confirmed otherwise at ship time.

---

## 4. Implementation specifics — Polygon/Massive adapter

Everything the adapter subagent needs to build `PolygonProvider` (a `FinancialDataProvider`) without
further research.

### Auth & base URL

- **Base URL:** `https://api.polygon.io` (legacy) — current canonical host is `https://api.massive.com`
  (the vendor rebranded Polygon.io → "Massive"; the API is the same surface). The docs' own sample
  `next_url` values use `https://api.massive.com`, so prefer `api.massive.com` and keep `api.polygon.io`
  as a fallback during the transition. ([docs](https://massive.com/docs/rest/stocks/aggregates/custom-bars))
- **Auth:** API key passed as a **query parameter** `apiKey=YOUR_API_KEY`. The documented cURL form is
  `curl -X GET "https://api.massive.com/v3/reference/tickers/AAPL?apiKey=YOUR_API_KEY"`.
  ([ticker docs](https://massive.com/docs/rest/stocks/tickers/ticker-overview))
  - NOTE: legacy Polygon used `Authorization: Bearer <key>`; the current Massive docs use the
    `apiKey` query param. If the query param 401s during integration, try the Bearer header — but
    ship the query-param form per current docs.
  - BYOK: the key comes from the user (no OAuth server). Store via the existing `CredentialStore`
    path; never log it; the renderer only ever sees metadata.

### Capability → endpoint mapping

| Capability | Endpoint | Notes |
|---|---|---|
| `market.quote` | `GET /v2/snapshot/locale/us/markets/stocks/tickers/{ticker}` | One call consolidates day/minute/prevDay bars + lastTrade/lastQuote. [docs](https://massive.com/docs/rest/stocks/snapshots/single-ticker-snapshot) |
| `market.quote` (alt) | `GET /v2/last/trade/{ticker}` | Just the last trade (price/size/timestamp). [docs](https://massive.com/docs/rest/stocks/trades-quotes/last-trade) |
| `market.kline` | `GET /v2/aggs/ticker/{ticker}/range/{multiplier}/{timespan}/{from}/{to}` | OHLCV bars. [docs](https://massive.com/docs/rest/stocks/aggregates/custom-bars) |
| `company.profile` | `GET /v3/reference/tickers/{ticker}` | Name, description, exchange, currency, market cap, SIC, homepage, logo. [docs](https://massive.com/docs/rest/stocks/tickers/ticker-overview) |
| `research.news` (optional) | `GET /v2/reference/news` | Plan-gated; skip for the minimal adapter. [docs](https://massive.com/docs/rest/stocks/news) |

### Quote — sample response shape

`GET /v2/snapshot/locale/us/markets/stocks/tickers/AAPL?apiKey=…`
([docs](https://massive.com/docs/rest/stocks/snapshots/single-ticker-snapshot))

```json
{
  "request_id": "657e430f1ae768891f018e08e03598d8",
  "status": "OK",
  "ticker": {
    "day":   { "c": 120.4229, "h": 121.85, "l": 119.9, "o": 121.09, "v": 42527868 },
    "min":   { "c": 120.4229, "h": 120.46, "l": 120.37, "o": 120.44, "v": 2315, "t": 1699559040000 },
    "prevDay": { "c": 120.44, "h": 120.69, "l": 119.32, "o": 119.5, "v": 45223491 },
    "lastTrade": { "p": 120.42, "s": 100, "t": 1699559040000 },
    "lastQuote": { "P": 120.45, "p": 120.40, "S": 1, "s": 1, "t": 1699559040000 },
    "todaysChange": -0.0171,
    "todaysChangePerc": -0.014,
    "updated": 1699559040000000000
  }
}
```

- `lastQuote` is only returned when the plan includes quotes; `lastTrade` only when the plan includes
  trades — on the free tier, gate on field presence and fall back to `day`/`prevDay`.
- Bar fields: `o/h/l/c` (numbers), `v` (volume, number), `t` (epoch ms), `vw` (VWAP), `n` (tx count).
  `P`/`S` = bid price/size, `p`/`s` = ask price/size in lastQuote.

### Kline — params & response shape

`GET /v2/aggs/ticker/{ticker}/range/{multiplier}/{timespan}/{from}/{to}?adjusted=true&sort=asc&limit=120&apiKey=…`
([docs](https://massive.com/docs/rest/stocks/aggregates/custom-bars))

- Path params: `multiplier` (int), `timespan` ∈ `minute|hour|day|week|month|quarter|year`,
  `from`/`to` = `YYYY-MM-DD` or millisecond epoch.
- Query params: `adjusted` (bool, default true — split-adjusted), `sort` (`asc|desc`), `limit`
  (max **50000**, default 5000).

```json
{
  "adjusted": true,
  "queryCount": 2,
  "request_id": "6a7e466379af0a71039d60cc78e72282",
  "resultsCount": 2,
  "status": "OK",
  "ticker": "AAPL",
  "results": [
    { "c": 75.0875, "h": 75.15, "l": 73.7975, "n": 1, "o": 74.06, "t": 1577941200000, "v": 135647456, "vw": 74.6099 },
    { "c": 74.3575, "h": 75.145, "l": 74.125, "n": 1, "o": 74.2875, "t": 1578027600000, "v": 146535512, "vw": 74.7026 }
  ]
}
```

- Pagination: `next_url` carries a cursor; follow it to page. Map `timespan` to Folio's kline
  period input in the adapter.

### Profile — response shape (key fields)

`GET /v3/reference/tickers/{ticker}?apiKey=…` → `results` object
([docs](https://massive.com/docs/rest/stocks/tickers/ticker-overview)):

```json
{
  "count": 1,
  "request_id": "…",
  "results": {
    "ticker": "AAPL", "name": "Apple Inc.", "description": "…",
    "market": "stocks", "locale": "us", "primary_exchange": "XNAS",
    "currency_name": "usd", "market_cap": 3000000000000,
    "sic_description": "Electronic Computers", "homepage_url": "https://www.apple.com",
    "branding": { "logo_url": "https://api.massive.com/v1/reference/company-branding/…_logo.svg", "icon_url": "…" }
  }
}
```

### Rate limits & freshness (must surface in provenance)

- Free **Stocks Basic**: **5 API calls/minute**, **end-of-day** data, 2 years history, labeled
  "Individual use". ([pricing](https://massive.com/pricing))
- Plan recency ladder: Basic = **End-of-day**; Starter ($29/mo) & Developer = **15-minute delayed**;
  Advanced = **real-time**; Business = **real-time**. ([custom-bars "Plan Recency"](https://massive.com/docs/rest/stocks/aggregates/custom-bars))
- The adapter MUST set `ProviderProvenance.delayed = true` when the plan is EOD/15-min-delayed, and
  `stale` accordingly — the contract forbids faking provenance (§62).
- Real-time US data requires a paid plan (exchange fees) — that is the same reason every other
  vendor's free tier is personal-use-only.

### Error mapping (adapter guidance)

- HTTP 401 → `AUTH_EXPIRED`; 403 → `AUTH_EXPIRED` (or `UNSUPPORTED_CAPABILITY` if the plan lacks the
  endpoint); 429 → `RATE_LIMITED`; 404 → `UNSUPPORTED_CAPABILITY` (unknown ticker) or a user-safe
  "no data"; 5xx → `TIMEOUT`/`UNKNOWN`. Never surface raw vendor output in `message` (contract).

---

## 5. Risks

1. **Free tier is not a commercial license.** Polygon "Stocks Basic" = "Individual use". Shipping the
   adapter with a hardcoded/company key, or telling business users to paste a free key, breaches the
   Individuals ToS. Resolution: (a) BYOK where each user's own license governs, and (b) Folio obtains
   a **Business** plan (real-time + `Edge Users`) before commercial distribution. Surface this in the
   Connections UI, not in a log line.
2. **Attribution.** Polygon's Market Data Terms (incorporated by reference) require display
   attribution ("Powered by Polygon.io"). Confirm the exact required text/placement at ship time; it
   is a display requirement, not a prohibition, but must be honored.
3. **Rebrand volatility.** Polygon.io → "Massive" changed the canonical host (`api.massive.com`) and
   the documented auth form (`apiKey` query param vs. legacy Bearer header). Pin the host and auth
   form in the adapter, and re-verify both against a live key at integration (a dev instance of the
   app is running; the adapter's own test can use `FINAGENT_FORCE_PROD_LOAD=1`).
4. **US-only coverage.** Polygon has no HK/CN/SG equities. That is fine because Longbridge (primary)
   owns those markets; the router must never route an HK/CN/SG symbol to Polygon (declare
   `markets(): Market[] = [US]` and `capabilities()` honestly so `coverage()` renders the matrix
   correctly).
5. **Free-tier freshness.** 5 calls/min + EOD means a slow, stale proof. Mitigate with a small
   in-memory cache/TTL and coalescing in the adapter so the router smoke test stays under the cap.

## 6. Why the runner-ups lost (one line each)

- **EODHD** — best US/HK/CN/SG coverage, but standard plans are *"personal use only"* and commercial
  use requires a sales quote, which violates the licensing-first rule outright.
- **Finnhub** — clean API, real-time US, generous 60/min free, but ToS says *"strictly for personal
  use"* and forbids redistribution *"without written approval"*.
- **Twelve Data** — best DX (llms.txt/SDKs) and 70+ markets, but free tier is *"non-display usage
  only"* and commercial use on the free tier is explicitly prohibited; real distribution rights cost
  $1,099/mo.
- **Alpha Vantage** — strong fundamentals, but 25 req/day free, intraday is now Premium, and docs
  state *"for your personal use. For commercial use, contact sales."*
- **Tiingo** — now has real-time (IEX) + fundamentals + a news API, but US-only and a personal-use
  free tier with no self-serve commercial/redistribution path.
- **Yahoo Finance** — unofficial scraper; no key, no SLA, and redistribution violates Yahoo's ToS —
  a non-starter for a release candidate.

---

## 7. Required integration changes (report-only — not edited here)

The adapter subagent owns `PolygonProvider`; these touchpoints are Lead/owner-owned and must be wired
by them, per the IPC/lead-ownership rules:

1. **New provider id/name:** register as `polygon` / "Polygon.io (Massive)" with
   `kind: 'financial-data'`. Do not edit `packages/core/src/index.ts` or `packages/shared/src/index.ts`.
2. **New IPC channel** for provider-B credential + status (if ProviderCore's generic channel isn't
   reused): report `providerB:setKey` / `providerB:status` (payload: `{ key?: string }`, status returns
   `ProviderHealth`) for preload/client wiring via `toIpcResult`/`unwrapIpcResult`.
3. **Router registration:** `FinancialProviderRouter.register(polygonProvider)`; route
   `market.quote`/`market.kline`/`company.profile` → Polygon as **fallback** behind Longbridge
   primary (`ProviderRoutingConfig`).
4. **Coverage matrix:** `coverage()` should report Polygon covering `market.quote`, `market.kline`,
   `company.profile` for `market US` only.
