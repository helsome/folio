# Yahoo Finance market data

Folio can load **US quotes, daily/weekly candles, and a short company profile** from Yahoo Finance without an API key and without Longbridge or Massive.

## What this is

- **Free and unofficial.** The adapter calls Yahoo's public chart endpoint (`query1.finance.yahoo.com/v8/finance/chart`). It is not a documented Yahoo API and there is no contract, SLA, or support.
- **Delayed.** Results are marked delayed. This is not a real-time feed.
- **Personal use.** Yahoo's terms restrict this kind of access to personal use. Do not redistribute the data or ship it as a commercial market-data feed.
- **US listings only.** Hong Kong, China A-share, and Singapore symbols stay on Longbridge. Index symbols such as `SPX` are mapped to Yahoo's index tickers (`^GSPC`).
- **Daily and weekly candles only.** Intraday periods stay on a provider that actually serves them.

The endpoint can change, block clients, or rate-limit without notice. Folio caches successful responses for about a minute and sends a normal browser User-Agent because the host rejects empty agents.

## How to enable it

Yahoo is registered automatically. No environment variable is required.

1. Open **Settings → Connections**.
2. Yahoo Finance is ready without a key. The card explains the delayed, unofficial, personal-use limits.
3. Leave the defaults in place to use it as a **backup**: Longbridge is primary, Massive is the configured fallback, and Yahoo answers US quote, candle, and profile requests when those two fail or are not configured.
4. Use **Use as primary** or **Use as fallback** on the Yahoo card when you want it earlier in the chain. Use the enable checkbox or **Disconnect** to turn it off. **Test Connection** requests `AAPL.US`.

Quote, chart, watchlist, and compare freshness lines show the provider that actually returned the data (`Yahoo Finance`, `Longbridge`, or `Massive (Polygon.io)`), including when the data is delayed.

## Quote day-change integrity

The quote adapter requests one month of daily bars and anchors the quote session to `regularMarketTime` in `exchangeTimezoneName`. It uses the preceding session's **Close**, never a range baseline (`chartPreviousClose`), dividend-adjusted `Adj Close`, the host's current date, or the current day's partial close. Duplicate daily rows are grouped by exchange date; null slots keep their original alignment.

When the preceding weekday bar, its close, the quote timestamp, or the exchange timezone cannot be verified, the quote is unavailable. Folio currently has no authoritative US holiday calendar: a holiday gap is conservatively unavailable rather than silently using an older close. Any split returned at or after the preceding session makes the quote unavailable, including a split dated after the quote: historical bars and the latest regular price may update to a new basis asynchronously. Historical split-adjusted closes are never divided by the split ratio again. These safeguards favor an explicit gap over a fabricated daily change or 0%.

Provider failures in the watchlist render **Quote unavailable**, with no implicit sample-price substitution. Successful rows retain their own provider and market timestamp in the aggregate freshness line.
