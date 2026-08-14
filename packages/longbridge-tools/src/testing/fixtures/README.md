# LongBridge CLI Test Fixtures

Real `longbridge --format json` output captured from CLI **v0.17.0** (region `cn`,
authenticated). These fixtures are ground truth for `longbridge-tools` unit tests and
for downstream tool wrappers to code against without hitting the live CLI.

- Symbol used where one is required: `NVDA.US`.
- Account commands (`positions`, `assets`, `cash-flow`) use no symbol and reflect the
  authenticated account at capture time — **do not treat values as stable**; field
  shapes are the contract, values are sample data.
- Regenerate: `bash capture.sh` from this directory (requires the CLI, auth, and `jq`).

## Loading in tests

```ts
import { loadFixture } from './load-fixture.ts';

const depth = loadFixture<{ symbol: string }>('depth'); // parsed JSON
```

`loadFixture(name)` is path-safe: it rejects traversal, separators, and absolute paths.
Fixture names match `/^[A-Za-z0-9][A-Za-z0-9._-]*$/`.

## Coverage

| Command | Fixture | Invocation | Captured fields (top-level shape) |
|---|---|---|---|
| `depth` | `depth.json` | `longbridge depth NVDA.US --format json` | `{symbol, bids[], asks[]}` — price levels with `price`, `volume`, `position`, `order_num` |
| `trades` | `trades.json` | `longbridge trades NVDA.US --count 20 --format json` | array of `{time, price, volume, direction, type}` |
| `capital` | `capital.json` | `longbridge capital NVDA.US --format json` | `{symbol, timestamp, capital_in{large,medium,small}, capital_out{...}}` |
| `capital --flow` | `capital-flow.json` | `longbridge capital NVDA.US --flow --format json` | array of `{time, inflow}` (391 points) |
| `market-temp` | `market-temp.json` | `longbridge market-temp US --format json` | array of `{field, value}` pairs (`Market`, `Temperature`, `Description`, `Valuation`, `Sentiment`) |
| `financial-report` | `financial-report.json` | `longbridge financial-report NVDA.US --format json` | `{symbol, report, list:{BS,CF,IS}}` — each `{indicators[]}` |
| `institution-rating` | `institution-rating.json` | `longbridge institution-rating NVDA.US --format json` | `{analyst{evaluate,target,industry_*}, instratings{evaluate,recommend,target}}` |
| `dividend` | `dividend.json` | `longbridge dividend NVDA.US --format json` | `{total, list[]}` — `ex_date`, `payment_date`, `record_date`, `desc`, `id` |
| `forecast-eps` | `forecast-eps.json` | `longbridge forecast-eps NVDA.US --format json` | `{items[]}` — `forecast_eps_mean/median/highest/lowest`, `forecast_end_date`, `institution_*` |
| `finance-calendar` | `finance-calendar.json` | `longbridge finance-calendar financial --format json` | `{date, list[], next_date, result}` (empty `list` at capture time) |
| `trading` | `trading.json` | `longbridge trading session --format json` | array of `{market, sessions[{session, open, close}]}` |
| `positions` | `positions.json` | `longbridge positions --format json` | array of `{symbol, name, quantity, available, cost_price, currency, market}` |
| `assets` | `assets.json` | `longbridge assets --format json` | array of `{net_assets, total_cash, buy_power, init_margin, maintenance_margin, currency, cash_infos[], risk_level, ...}` |
| `cash-flow` | `cash-flow.json` | `longbridge cash-flow --format json` | array of `{time, balance, business_type, flow_name, description, symbol, currency}` |
| `valuation` | `valuation.json` | `longbridge valuation NVDA.US --format json` | `{overview, peers, stocks, history, layouts}` |
| `static` | `static.json` | `longbridge static NVDA.US --format json` | array of `{symbol, name, exchange, currency, eps, eps_ttm, bps, dividend, total_shares, circ._shares, lot_size}` |
| `calc-index` | `calc-index.json` | `longbridge calc-index NVDA.US --format json` | array of `{symbol, pe, pb, dps_rate, turnover_rate, total_market_value}` |
| `market-status` | `market-status.json` | `longbridge market-status --format json` | array of `{market, status}` |
| `news` | `news.json` | `longbridge news NVDA.US --count 20 --format json` | array of `{id, title, url, published_at, comments_count, likes_count}` |

Every fixture also has a sibling `<name>.cmd.txt` recording the exact invocation. No
command failed at capture time, so no `.error.txt` files are present.

## CLI quirks (for tool wrappers)

- Several "single-symbol" commands return a **JSON array** rather than an object:
  `static`, `calc-index`, `assets` (one-element arrays); `positions`, `trades`, `news`,
  `cash-flow` (0..N). Wrap parsers accordingly.
- `market-temp` returns `[{field, value}, ...]`, not a flat object, and takes a
  **market** (`US`/`HK`/`CN`/`SG`), not a symbol.
- `trading` requires a subcommand (`session` | `days`); the bare command errors.
- `finance-calendar` requires a positional `EVENT_TYPE` (`financial`, `report`,
  `dividend`, `ipo`, `macrodata`, `closed`); symbol is an optional repeatable `--symbol`
  filter.
- `financial-report` defaults `--kind ALL` and `--report qf` (quarterly); `report` field
  echoes the period string.
- `capital` uses `--flow` for the time series; snapshot is `{capital_in, capital_out}`.
- Numeric fields arrive as **strings** (`"34.120"`, `"5445387000000.000"`) in several
  commands (`calc-index`, `capital`, `trades`, `depth`). Convert before arithmetic.
