> 本文是 [provider-b-decision.md](provider-b-decision.md) 的中文翻译；如有出入，以英文原文为准。

# 提供商 B — 二级行情数据提供商决策

状态：**仅研究**（无代码变更）。为最小化 V4 提供商平台适配器做出决策，该适配器用于验证路由器架构（规格 §12–13）。

- 实现所依据的契约：`packages/core/src/provider.ts`（`FinancialDataProvider`、`ProviderResult`、`ProviderProvenance`、`ProviderCoverage`、`DEFAULT_MARKETS = US/HK/CN/SG`）。
- 目标能力切片：**`market.quote` + `market.kline` + `company.profile`**（仅行情数据）。不含投资组合。`research.news` 对本适配器为可选。

---

## 1. 建议（简版）

**Polygon.io（现已更名为 "Massive"）——美股，`quote + kline + profile`。**

在全部候选中，只有 Polygon 的许可结构提供了一条明确、可自助办理的商业路径：「Massive for Businesses」服务条款赋予客户将其数据提供给「Authorized Users（授权用户）」与 **「Edge Users（边缘用户）」**（即客户产品的终端用户）的权利——这正是 Folio 所需的桌面应用分发形态。其他所有候选的免费/自助套餐均为「仅限个人使用（personal use only）」，并明确禁止再分发（见 §3）。按照规格 §12 的规则——*"a provider whose terms forbid redistribution is disqualified no matter how good the API"*（“无论 API 多好，只要其条款禁止再分发即被淘汰”）——Polygon 是唯一幸存者。

唯一需要注意的硬性限制：Polygon 的**免费「Stocks Basic」套餐本身即标注为「个人用途（Individual use）」**，返回的是**日终（end-of-day）**数据（而非实时数据）。这对构建并冒烟测试适配器（5 次调用/分钟）是可以接受的，但商业版 Folio 发布需要 **Business 计划**（实时数据、`Edge Users` 权利）——或采用 BYOK 模式，由每个终端用户自己的许可来约束。这一点在 §4（风险）中已记录，并且必须在 Connections UI 中如实呈现，不能悄悄掩盖。

---

## 2. 对比矩阵

图例：✅ 良好 · ⚠️ 部分 / 受限制 · ❌ 淘汰或缺失。每个单元格都引用了相应声明的官方供应商页面。

| 标准 | Polygon (Massive) | Alpha Vantage | Finnhub | Twelve Data | Tiingo | EODHD | Yahoo Finance |
|---|---|---|---|---|---|---|---|
| **API 可用性**（行情/K 线/公司资料/新闻） | ✅ 行情 + aggs（K 线）+ ticker-details（公司资料）+ 新闻，单一 REST API — [文档](https://massive.com/docs/rest/stocks/overview) | ⚠️ 行情+K 线可用，但**盘中数据现已成为 Premium 端点** — [文档](https://www.alphavantage.co/documentation/#intraday) | ✅ 行情 + 蜡烛（K 线）+ 公司资料 + 新闻 — [文档](https://finnhub.io/docs/api) | ✅ 行情 + time_series + 公司资料 + 新闻 — [文档](https://twelvedata.com/docs/llms/market-data.md) | ⚠️ 日终/行情/iex 实时 + 基本面 + 新闻（较新产品）— [文档](https://www.tiingo.com/documentation/news) | ✅ 行情 + 日终 + 盘中 + 公司资料 + 新闻，45+ 个 API — [文档](https://eodhd.com/financial-apis/) | ⚠️ 通过**非官方抓取**（`yfinance`）提供行情/K 线/公司资料/新闻，无官方 API — [yfinance](https://github.com/ranaroussi/yfinance) |
| **市场 US/HK/CN/SG** | ❌ **仅美股**（locale `us`）— [ticker 文档](https://massive.com/docs/rest/stocks/tickers/ticker-overview) | ⚠️ 美股 + 部分全球日终数据；HK/CN/SG 覆盖零散 — [文档](https://www.alphavantage.co/documentation/) | ⚠️ 美股较强；全球数据通过 international 端点，HK/CN/SG 薄弱 — [文档](https://finnhub.io/docs/api) | ⚠️ 70+ 交易所，含 HK/CN/SG **但仅限付费套餐**（免费 = 仅美股）— [定价](https://twelvedata.com/pricing) | ❌ 仅美股（IEX）— [文档](https://www.tiingo.com/documentation/iex) | ✅ **70+ 交易所，含 US/HK/CN/SG** — [文档](https://eodhd.com/financial-apis/exchanges-api-list-of-tickers-and-trading-hours) | ⚠️ 通过抓取提供美股 + 全球数据；非官方 — [yfinance](https://github.com/ranaroussi/yfinance) |
| **实时 vs 延迟** | ⚠️ 免费 = **日终**；Starter $29 = 延迟 15 分钟；仅 Advanced/Business 提供实时数据 — [定价](https://massive.com/pricing) | ❌ 实时 + 延迟 15 分钟**仅限 premium 套餐** — [文档](https://www.alphavantage.co/documentation/#intraday) | ✅ 免费套餐提供美股实时数据 — [文档](https://finnhub.io/docs/api/quote) | ⚠️ 免费套餐提供美股实时；其他市场实时数据需付费 — [定价](https://twelvedata.com/pricing) | ⚠️ 免费套餐提供美股实时数据（IEX）— [文档](https://www.tiingo.com/documentation/iex) | ⚠️ 付费套餐提供实时数据（WebSocket）；免费套餐提供日终/盘中数据 — [文档](https://eodhd.com/financial-apis/new-real-time-data-api-websockets) | ⚠️ 通过抓取获得约延迟 15 分钟的行情，无保证 — [yfinance](https://github.com/ranaroussi/yfinance) |
| **基本面深度** | ⚠️ Business 套餐提供 ticker 详情 + 财务数据；深度不及 Finnhub/EODHD — [ticker 文档](https://massive.com/docs/rest/stocks/tickers/ticker-overview) | ✅ 利润表/资产负债表/现金流量表/概览 — [文档](https://www.alphavantage.co/documentation/#fundamentals) | ✅ 基础财务数据免费，标准财务数据需 premium — [文档](https://finnhub.io/docs/api/financials) | ✅ 利润表/资产负债表/现金流量表/统计/公司资料 — [文档](https://twelvedata.com/docs/llms/fundamentals.md) | ✅ 每日基本面 + 财务报表 — [文档](https://www.tiingo.com/documentation/fundamentals) | ✅ 深度基本面数据，70+ 交易所 — [文档](https://eodhd.com/financial-apis/stock-etfs-fundamental-data-feeds) | ⚠️ 通过抓取获得公司资料/财务报表 — [yfinance](https://github.com/ranaroussi/yfinance) |
| **新闻可用性** | ⚠️ `/v2/reference/news` 存在（受套餐限制）— [新闻](https://massive.com/docs/rest/stocks/news) | ✅ NEWS_SENTIMENT — [文档](https://www.alphavantage.co/documentation/#news-sentiment) | ✅ 公司新闻（免费）+ 综合新闻 — [文档](https://finnhub.io/docs/api/company-news) | ✅ 通过 fundamentals 提供 press_releases/新闻 — [文档](https://twelvedata.com/docs/llms/fundamentals.md) | ✅ 新闻 API（较新产品）— [文档](https://www.tiingo.com/documentation/news) | ✅ 新闻 + 情绪 — [文档](https://eodhd.com/financial-apis/stock-market-financial-news-api) | ⚠️ 通过抓取获得新闻 — [yfinance](https://github.com/ranaroussi/yfinance) |
| **认证（API 密钥，无 OAuth）** | ✅ `apiKey` 查询参数（单一密钥）— [文档](https://massive.com/docs/llms.txt) | ✅ `apikey` 查询参数 — [文档](https://www.alphavantage.co/documentation/) | ✅ `token` 参数 / `X-Finnhub-Token` 请求头 — [文档](https://finnhub.io/docs/api) | ✅ `apikey` 查询参数 — [文档](https://twelvedata.com/docs/llms/introduction.md) | ✅ `Authorization: Token` 请求头 — [文档](https://www.tiingo.com/documentation) | ✅ `api_token` 查询参数 — [文档](https://eodhd.com/financial-apis/) | ❌ 无（抓取，无密钥） |
| **速率限制（免费套餐）** | ⚠️ 5 次 API 调用/分钟（$29 Starter 套餐不限量）— [定价](https://massive.com/pricing) | ❌ 25 次请求/**天** — [支持](https://www.alphavantage.co/support/) | ✅ 60 次调用/分钟（+ 30 次/秒硬上限）— [定价](https://finnhub.io/pricing) · [ToS](https://finnhub.io/terms-of-service) | ⚠️ 8 个 credit/分钟 + 800 次请求/天上限，**仅美股** — [定价](https://twelvedata.com/pricing) | ⚠️ 约 1000 次请求/天，50 次请求/小时（免费）— [文档](https://www.tiingo.com/documentation) | ⚠️ 免费 20 次 API 调用/天 — [定价](https://eodhd.com/pricing) | ❌ 抓取受限/降级，无 SLA — [yfinance](https://github.com/ranaroussi/yfinance) |
| **许可 / 再分发** | ⚠️ 免费 = 「个人用途（Individual use）」；**Business 服务条款允许「Edge Users」**（见 §3）— [条款](https://massive.com/legal/terms) | ❌ 「premium… **仅供您个人使用**。如需商业用途，请联系销售」— [文档](https://www.alphavantage.co/documentation/) | ❌ 「严格**仅供个人使用**」；「未经书面批准不得再分发……」；「任何企业即使内部使用也不允许」— [ToS](https://finnhub.io/terms-of-service) | ❌ 免费 = 「**仅限非展示用途**」；禁止「将免费套餐数据用于商业目的」；再分发需要付费附加项 — [条款](https://twelvedata.com/terms) | ⚠️ 免费套餐仅供个人使用；**未记载自助式商业/再分发套餐** — [文档](https://www.tiingo.com/documentation) | ❌ 「套餐…**仅供个人使用**，商业用途需要」销售报价 — [许可](https://eodhd.com/financial-apis/commercial-vs-personal-license-use) | ❌ **非官方**；抓取/再分发违反 Yahoo 服务条款 — [Yahoo ToS](https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html) |
| **开发者体验** | ✅ 简洁的 REST + JSON、官方 SDK、条理清晰的文档 — [文档](https://massive.com/docs/llms.txt) | ⚠️ 可用但过时，每天 25 次对开发而言太苛刻 — [文档](https://www.alphavantage.co/documentation/) | ✅ 简洁，但服务条款将其淘汰 — [文档](https://finnhub.io/docs/api) | ✅ 优秀（llms.txt、SDK），但免费套餐仅限美股/非展示 — [文档](https://twelvedata.com/docs/llms.txt) | ⚠️ 尚可，SPA 文档难以抓取 — [文档](https://www.tiingo.com/documentation) | ✅ 覆盖面广，WordPress 文档，覆盖良好 — [文档](https://eodhd.com/financial-apis/) | ⚠️ 无官方文档，仅社区库 — [yfinance](https://github.com/ranaroussi/yfinance) |
| **价格** | ✅ 开发免费；Starter $29；Developer $79；Advanced $199；Business（定制）— [定价](https://massive.com/pricing) | ⚠️ 免费 25 次/天；Premium $49.99–$249/月 — [定价](https://www.alphavantage.co/premium/) | ✅ 免费 60 次/分钟；Premium 起价 $49.99/月 — [定价](https://finnhub.io/pricing) | ⚠️ 免费；Business 起价 $149/月；再分发 $1,099/月 — [定价](https://twelvedata.com/pricing) | ✅ 免费；付费起价约 $10/月 — [定价](https://www.tiingo.com/about/pricing) | ⚠️ 免费 20 次/天；付费起价约 $19.99/月 — [定价](https://eodhd.com/pricing) | ✅ 免费（抓取）— [yfinance](https://github.com/ranaroussi/yfinance) |

---

## 3. 许可分析（决定性标准）

规格 §12 将许可/再分发设为**第一道**门槛。Folio 是一款在界面中展示行情数据的商业桌面应用；若某提供商在用户实际会持有的套餐条款中写明「仅限个人使用（personal use only）」或「不得再分发」，那么无论 API 质量如何，该提供商都会被淘汰。以下为逐字条款及出处：

- **Finnhub** — *"You hereby agree to not redistribute or share access to data or derived results… without written approval. All plan listed on Finnhub website is strictly for personal use unless explicitly stated otherwise. Personal plan can't be used by any business even internally without a written approval."*（“您特此同意，未经书面批准，不得再分发或分享数据或衍生结果的访问权限……除非另有明确说明，所有在 Finnhub 网站上列出的套餐均严格仅供个人使用。个人套餐未经书面批准，任何企业即使内部使用也不得使用。”）→ **淘汰。**（[ToS](https://finnhub.io/terms-of-service)）
- **Twelve Data** — 免费/Basic 为 *"internal non-display usage only"*（“仅供内部非展示用途”）；服务条款 §2.3 禁止 *"(l) Use Free Tier data for commercial purposes"*（“(l) 将免费套餐数据用于商业目的”）；*"Redistribution"*（有定义）需要 *"Redistribution Rights Add-On or separate written agreement"*（“再分发权利附加项或单独的书面协议”，Enterprise $1,099/月）；*"Business plans are required for any company… even if the data is only used internally."*（“任何公司都需要 Business 套餐……即使数据仅供内部使用。”）→ **免费套餐即被淘汰。**（[定价](https://twelvedata.com/pricing) · [条款](https://twelvedata.com/terms)）
- **EODHD** — *"The packages on the pricing page are intended for personal use only as commercial use requires a more thorough approach to licensing and data use."*（“定价页面上的套餐仅供个人使用，因为商业用途需要对许可和数据使用采取更严谨的方式。”）商业用途需要销售报价（表单），因为 *"we are required to report all commercial users of exchange data to the relevant exchanges."*（“我们必须将交易所数据的全部商业用户上报给相关交易所。”）→ **淘汰**（尽管其 US/HK/CN/SG 覆盖最佳）。（[许可](https://eodhd.com/financial-apis/commercial-vs-personal-license-use)）
- **Alpha Vantage** — *"subscribe to a premium membership plan for your personal use. For commercial use, please contact sales."*（“请订阅 premium 会员套餐以供您个人使用。如需商业用途，请联系销售。”）→ **淘汰。**（[文档](https://www.alphavantage.co/documentation/)）
- **Tiingo** — 免费套餐仅供个人使用，且未记载自助式商业/再分发套餐（不同于 Polygon 明确的 Business +「Edge Users」路径）；仅支持美股。未能从可抓取的页面获取其服务条款的准确措辞——在采用任何 Tiingo 后备方案之前，请重新核实该条款。（[文档](https://www.tiingo.com/documentation)）
- **Yahoo Finance** — 无官方 API；`yfinance` 是一个抓取器。Yahoo 的服务条款禁止自动化访问及其内容的再分发，因此适配器将建立在 Folio 无法满足的条款和根本不存在的 SLA 之上。→ **淘汰。**（[Yahoo ToS](https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html) · [yfinance](https://github.com/ranaroussi/yfinance)）

**Polygon/Massive** 的结构截然不同，这正是它胜出的原因：

- 条款中心分为 **「Massive for Individuals」**（对「Individual Use」产品的个人、个人化、非商业用途）和 **「Massive for Businesses」**（对「Business Use」产品的个人、商业或商用用途）。（[条款](https://massive.com/legal/terms)）
- **Business 服务条款**的再分发条款允许将信息提供给 *"Customer, its Authorized Users, or its Edge Users"*（“客户、其授权用户或其边缘用户”）——其中「Edge Users」即客户产品的终端用户。这正是 Folio 的分发模式。（[businesses ToS](https://massive.com/legal/businesses-terms-of-service)）
- **Individuals 服务条款**明确写道：*"if you are using the Services for business or commercial purposes, you may not use any of the Services labeled for individual or personal use"*（“如果您将服务用于商业或商务目的，则不得使用任何标注为个人或个人用途的服务”）——因此**免费的「Stocks Basic」套餐并非商业许可。**（[individuals ToS](https://massive.com/legal/individuals-terms-of-service)）

许可方面的最终结论：**在适配器/验证阶段使用免费的「个人用途（Individual use）」套餐（仅限开发）；任何商业发布都需要 Folio 采购 Polygon Business 计划（实时数据 + `Edge Users`）——与上述需销售接洽的「仅限个人使用」供应商不同，该计划的价格/条款是自助公开且文档化的。** 署名要求通过引用纳入 Polygon 的 Market Data 服务条款（两份 ToS 文档均引用了它）；在发布时另行确认之前，请将「Powered by Polygon.io」展示署名视为必需。

---

## 4. 实现细节 — Polygon/Massive 适配器

适配器子代理构建 `PolygonProvider`（一个 `FinancialDataProvider`）所需的一切，无需进一步调研。

### 认证与基础 URL

- **基础 URL：**`https://api.polygon.io`（旧版）——当前规范主机为 `https://api.massive.com`（供应商已将 Polygon.io 更名为「Massive」；API 表面完全一致）。文档自带的 `next_url` 示例值即使用 `https://api.massive.com`，因此优先使用 `api.massive.com`，并在过渡期内保留 `api.polygon.io` 作为后备。（[文档](https://massive.com/docs/rest/stocks/aggregates/custom-bars)）
- **认证：**API 密钥以**查询参数**形式传递：`apiKey=YOUR_API_KEY`。文档中的 cURL 形式为 `curl -X GET "https://api.massive.com/v3/reference/tickers/AAPL?apiKey=YOUR_API_KEY"`。（[ticker 文档](https://massive.com/docs/rest/stocks/tickers/ticker-overview)）
  - 注意：旧版 Polygon 使用 `Authorization: Bearer <key>`；当前 Massive 文档使用 `apiKey` 查询参数。如果集成期间查询参数返回 401，请尝试 Bearer 请求头——但按当前文档，交付时应使用查询参数形式。
  - BYOK：密钥来自用户（无 OAuth 服务器）。通过现有的 `CredentialStore` 路径存储；切勿写入日志；渲染进程永远只能看到元数据。

### 能力 → 端点映射

| 能力 | 端点 | 说明 |
|---|---|---|
| `market.quote` | `GET /v2/snapshot/locale/us/markets/stocks/tickers/{ticker}` | 一次调用即可整合 day/minute/prevDay 数据 + lastTrade/lastQuote。[文档](https://massive.com/docs/rest/stocks/snapshots/single-ticker-snapshot) |
| `market.quote`（备选） | `GET /v2/last/trade/{ticker}` | 仅返回最后一笔成交（价格/数量/时间戳）。[文档](https://massive.com/docs/rest/stocks/trades-quotes/last-trade) |
| `market.kline` | `GET /v2/aggs/ticker/{ticker}/range/{multiplier}/{timespan}/{from}/{to}` | OHLCV K 线。[文档](https://massive.com/docs/rest/stocks/aggregates/custom-bars) |
| `company.profile` | `GET /v3/reference/tickers/{ticker}` | 名称、简介、交易所、货币、市值、SIC、主页、标志。[文档](https://massive.com/docs/rest/stocks/tickers/ticker-overview) |
| `research.news`（可选） | `GET /v2/reference/news` | 受套餐限制；最小化适配器跳过。[文档](https://massive.com/docs/rest/stocks/news) |

### 行情 — 示例响应结构

`GET /v2/snapshot/locale/us/markets/stocks/tickers/AAPL?apiKey=…`
（[文档](https://massive.com/docs/rest/stocks/snapshots/single-ticker-snapshot)）

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

- 仅当套餐包含行情时才返回 `lastQuote`；仅当套餐包含成交时才返回 `lastTrade`——在免费套餐上，应根据字段是否存在做判断，并回退到 `day`/`prevDay`。
- K 线字段：`o/h/l/c`（数字）、`v`（成交量，数字）、`t`（毫秒时间戳）、`vw`（VWAP，成交量加权均价）、`n`（成交笔数）。在 lastQuote 中，`P`/`S` = 买价/买量，`p`/`s` = 卖价/卖量。

### K 线 — 参数与响应结构

`GET /v2/aggs/ticker/{ticker}/range/{multiplier}/{timespan}/{from}/{to}?adjusted=true&sort=asc&limit=120&apiKey=…`
（[文档](https://massive.com/docs/rest/stocks/aggregates/custom-bars)）

- 路径参数：`multiplier`（整数）、`timespan` ∈ `minute|hour|day|week|month|quarter|year`、`from`/`to` = `YYYY-MM-DD` 或毫秒时间戳。
- 查询参数：`adjusted`（布尔值，默认 true——复权调整）、`sort`（`asc|desc`）、`limit`（最大 **50000**，默认 5000）。

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

- 分页：`next_url` 携带游标，跟随其翻页。在适配器中，将 `timespan` 映射到 Folio 的 K 线周期输入。

### 公司资料 — 响应结构（关键字段）

`GET /v3/reference/tickers/{ticker}?apiKey=…` → `results` 对象
（[文档](https://massive.com/docs/rest/stocks/tickers/ticker-overview)）：

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

### 速率限制与数据新鲜度（必须在来源中呈现）

- 免费 **Stocks Basic**：**5 次 API 调用/分钟**、**日终（end-of-day）**数据、2 年历史，标注为「个人用途（Individual use）」。（[定价](https://massive.com/pricing)）
- 套餐时效阶梯：Basic = **日终**；Starter（$29/月）与 Developer = **延迟 15 分钟**；Advanced = **实时**；Business = **实时**。（[custom-bars "Plan Recency"](https://massive.com/docs/rest/stocks/aggregates/custom-bars)）
- 当套餐为日终/延迟 15 分钟时，适配器必须设置 `ProviderProvenance.delayed = true`，并相应设置 `stale`——契约禁止伪造来源（§62）。
- 美股实时数据需要付费套餐（交易所费用）——这正是其他所有供应商的免费套餐仅限个人使用的原因。

### 错误映射（适配器指南）

- HTTP 401 → `AUTH_EXPIRED`；403 → `AUTH_EXPIRED`（若套餐缺少该端点则为 `UNSUPPORTED_CAPABILITY`）；429 → `RATE_LIMITED`；404 → `UNSUPPORTED_CAPABILITY`（未知代码）或对用户安全的「无数据」；5xx → `TIMEOUT`/`UNKNOWN`。切勿在 `message` 中暴露供应商的原始输出（契约要求）。

---

## 5. 风险

1. **免费套餐不是商业许可。**Polygon 的「Stocks Basic」=「个人用途（Individual use）」。使用硬编码/公司密钥发布适配器，或让商业用户粘贴免费密钥，都违反 Individuals 服务条款。解决方案：（a）采用 BYOK，由每个用户自己的许可约束；（b）在商业分发之前，Folio 采购 **Business** 计划（实时数据 + `Edge Users`）。在 Connections UI 中呈现这一点，而不是写进日志行。
2. **署名。**Polygon 的 Market Data 条款（通过引用纳入）要求展示署名（「Powered by Polygon.io」）。发布时确认所需的确切文字/位置；这是一项展示要求而非禁令，但必须遵守。
3. **更名波动。**Polygon.io →「Massive」更改了规范主机（`api.massive.com`）和文档化的认证形式（`apiKey` 查询参数 vs. 旧版 Bearer 请求头）。在适配器中固定主机与认证形式，并在集成时用真实密钥重新验证二者（应用的开发实例正在运行；适配器自身的测试可以使用 `FINAGENT_FORCE_PROD_LOAD=1`）。
4. **仅覆盖美股。**Polygon 没有 HK/CN/SG 股票。这没问题，因为 Longbridge（主提供商）拥有这些市场；路由器绝不能将 HK/CN/SG 标的路由到 Polygon（如实声明 `markets(): Market[] = [US]` 和 `capabilities()`，使 `coverage()` 正确渲染矩阵）。
5. **免费套餐的数据新鲜度。**5 次调用/分钟 + 日终数据意味着一个缓慢而过时的验证。通过在适配器中加入小型内存缓存/TTL 和请求合并来缓解，使路由器冒烟测试保持在限额之下。

## 6. 落选者为何出局（各一行）

- **EODHD** —— US/HK/CN/SG 覆盖最佳，但标准套餐为 *"personal use only"*（“仅供个人使用”），商业用途需要销售报价，直接违反许可优先规则。
- **Finnhub** —— API 简洁、美股实时、慷慨的免费 60 次/分钟，但服务条款写明 *"strictly for personal use"*（“严格仅供个人使用”），并禁止 *"without written approval"*（“未经书面批准”）的再分发。
- **Twelve Data** —— 开发者体验最佳（llms.txt/SDK）且覆盖 70+ 市场，但免费套餐为 *"non-display usage only"*（“仅限非展示用途”），免费套餐上的商业用途被明确禁止；真正的再分发权利需 $1,099/月。
- **Alpha Vantage** —— 基本面数据强大，但免费仅 25 次请求/天，盘中数据现为 Premium，且文档写明 *"for your personal use. For commercial use, contact sales."*（“仅供您个人使用。如需商业用途，请联系销售。”）
- **Tiingo** —— 如今提供实时（IEX）+ 基本面 + 新闻 API，但仅限美股，免费套餐仅供个人使用，且没有自助式商业/再分发路径。
- **Yahoo Finance** —— 非官方抓取器；无密钥、无 SLA，且再分发违反 Yahoo 服务条款——对发布候选而言根本不可行。

---

## 7. 必需的集成变更（仅报告——此处不修改）

适配器子代理负责 `PolygonProvider`；以下接触点归 Lead/负责人所有，必须由他们完成接线，依据 IPC/负责人归属规则：

1. **新提供商 id/名称：**以 `polygon` / "Polygon.io (Massive)" 注册，`kind: 'financial-data'`。不要编辑 `packages/core/src/index.ts` 或 `packages/shared/src/index.ts`。
2. **新的 IPC 通道**，用于提供商 B 的凭据 + 状态（若不复用 ProviderCore 的通用通道）：上报 `providerB:setKey` / `providerB:status`（载荷：`{ key?: string }`，状态返回 `ProviderHealth`），供预加载/客户端通过 `toIpcResult`/`unwrapIpcResult` 接线。
3. **路由器注册：**`FinancialProviderRouter.register(polygonProvider)`；将 `market.quote`/`market.kline`/`company.profile` 作为 Longbridge 主提供商之后的**后备**路由到 Polygon（`ProviderRoutingConfig`）。
4. **覆盖矩阵：**`coverage()` 应报告 Polygon 仅覆盖 `market US` 的 `market.quote`、`market.kline`、`company.profile`。
