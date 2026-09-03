# Folio 设计稿 vs 当前实现 对比报告

> 数据来源：Stitch 设计稿 **Minimalist Personal Portfolio**（桌面端，11 屏）。
> 对比基准：`packages/ui` 当前工作区实现。
> 生成方式：通过 Stitch MCP（Streamable HTTP，`tools/call list_screens`）拉取全部屏幕的截图与 HTML 源码逐屏比对。

---

## 1. 设计系统（Institutional Intelligence）

| 维度 | Stitch 设计稿 | 当前实现 | 结论 |
|---|---|---|---|
| 色彩模式 | Light 为主（`#f7f9fb` 背景），带 dark_mode 切换按钮 | Light/Dark 主题均支持（ThemeProvider） | ✅ 基本一致 |
| 主色 | `primary #000000`、`charcoal-deep #0F172A` | 近似的中性深色体系 | ✅ |
| 语义色 | `market-up #10B981` / `market-down #EF4444`、`provenance-link #6366F1`、`null-placeholder #94A3B8` | `--mac-green`/`--mac-red`/accent 变量 | ⚠️ 语义对齐但 token 值不同（设计稿红绿为 Tailwind 调色板色） |
| 字体 | 标题 **Geist**、正文 **Inter**、表格数字 **JetBrains Mono**（`text-data-tabular` 13px） | Inter 为主，无 JetBrains Mono 数据字体 | ⚠️ 缺少 tabular 数据字体层 |
| 字号阶梯 | `display-lg 32px / headline-md 24px / body-md 14px / label-caps 11px (0.05em)` | 相近的自定义阶梯（`font-display-lg` 等） | ✅ |
| 圆角 | 全局偏小（`DEFAULT 0.125rem`、`xl 0.5rem`、`full 0.75rem`） | 4–16px 混用 | ✅ |
| 布局常量 | `sidebar-width 240px`、`right-rail-width 400px`、`grid-margin 24px` | 侧栏宽度接近；右侧 Copilot 栏为独立面板 | ⚠️ 设计稿为固定三栏（240 + 弹性 + 400） |

---

## 2. 逐屏对比

### 2.1 Workbench（AAPL Research，核心研究台）
设计稿要素：顶栏二级导航（K-Lines / Statements / News / Reports）、行情头（NASDAQ • Technology • $189.43 ↑1.2%）、**STANCE / CONFIDENCE 卡片**、价格图（1D/1W/1M 切换）、Key Catalysts / Primary Risks 双卡、**Key Metrics & Valuation 表（CURRENT vs 5Y AVG + DELTA）**、右侧 Agent Copilot（思考过程虚线凹陷块 + 证据引用角标 `[1]` + "Evidence verified locally"）。

当前实现：
- ✅ Research 面板有 stance / confidence / cases / catalysts / risks / evidence（`ResearchReportView`、`ResearchMarketWorkspace`）
- ✅ K 线图（`FinancialKLineChart`，真实行情）
- ✅ Agent 面板（`AgentPanel`、ToolActivity、ContextChip）
- ❌ **缺少 METRIC / CURRENT / 5Y AVG / DELTA 估值对比表**（核心差异）
- ❌ 顶栏无 K-Lines / Statements / News / Reports 二级 Tab（设计稿的证券工作台聚合视图）
- ❌ Copilot 无"思考过程凹陷块 + 证据角标"的视觉样式（有 ToolActivity 但非该样式）

### 2.2 Today Dashboard
设计稿要素：问候语 + 当日市场脉搏、Total Portfolio Value（$12,450,210 +1.24%）、Top Gainers/Losers（NVDA +4.2% 等）、Upcoming Events（10/25 AAPL Earnings、10/27 PCE）、Watchlist Activity 表（含 Signal 列：Bullish MACD / Resistance Hit）、Agent 每日简报（风险告警 + 行动按钮）。

当前实现：
- ✅ 问候 + Portfolio 总览卡 + Top Gainers/Losers + Upcoming Events + Watchlist Movers + Daily Brief（`TodayView`，结构高度一致）
- ✅ Market Pulse（指数/温度/涨跌 mover/个人敞口）
- ❌ Watchlist Activity 无 **Signal 列**（Bullish MACD 等技术信号，当前只有价格与涨跌幅）
- ❌ Daily Brief 行动按钮（Run Stress Test / Analyze ETF 之类的直接动作）

### 2.3 Deep Research Report（TSLA）
设计稿要素：报告头（价格 + 跌幅、Stance Neutral Maintained、Confidence Medium "Based on 12 sources"、**Target Price $190.00 / Implied +8.4%**）、Executive Summary、**Research Diff（vs 上期：Auto Gross Margins −150bps、Energy Deployment +4GWh）**、Copilot Synthesis 带图表追问。

当前实现：
- ✅ 报告视图有 stance/confidence/summary/cases/evidence；core 里有 `research-diff.ts` 且 UI 有 `WhatChangedSection`（研究差异已落地）
- ❌ **Target Price / Implied Upside 卡片缺失**
- ❌ "Based on N sources" 置信度来源计数缺失

### 2.4 Events & Catalysts
设计稿要素：**VOLATILITY OUTLOOK 徽标**、按日分组（TODAY, OCT 24 · 3 EVENTS）、单事件卡带 **HIGH/MEDIUM IMPACT** 徽标、**COUNTDOWN（In 4h 12m）**、EXPECTED IMPACT 展开区、RELATED ASSETS chips（SPY/QQQ/TLT）、右侧 Catalyst Synthesis（LIVE）+ EXPOSURE ALERT。

当前实现：
- ✅ 事件列表（日期/类型/名称/描述/跳转 Research）
- ❌ 无影响分级徽标、无倒计时、无 Related Assets、无波动率展望、无右侧催化综述栏

### 2.5 Markets Overview
设计稿要素：指数卡（S&P/NASDAQ/FTSE + 1D/1W/1M）、**Sector Performance 横条**、**Discover Screens（17 Active + 5 个预置筛选器卡片）**、Core Watchlist 表（含 Vol(30d)、Signal 列）、Market Pulse 系统分析。

当前实现：
- ✅ Discover 视图已有筛选/候选卡（`DiscoverView`）、Watchlist 有页签
- ✅ Market Pulse 独立卡片
- ❌ 无 Sector Performance 板块条、无指数卡区（指数仅在 Today 的 Pulse 里）

### 2.6 Portfolio Analytics
设计稿要素：总览（$1.24B / +0.84%）、**Concentration & Exposure 环形图 + 板块权重**、**Risk Metrics（Herfindahl / Beta / Sharpe / Max Drawdown）**、Top Holdings 表（Weight / Cost Basis / Price / Return / Contr.）、Copilot 集中度告警 + "Generate Rebalance Scenario"。

当前实现：
- ✅ PortfolioCard（总值/现金/今日盈亏）、AssetPieChart、HoldingRow、PortfolioRiskPanel（集中度/风险）、手动导入组合
- ❌ 无 Herfindahl / Beta / Sharpe 指标行（core 有 `portfolio-risk.ts`，UI 未完整呈现）、无再平衡场景生成

### 2.7 Alerts & Monitoring
设计稿要素：Quick Create（Target / Rule Type 7 种 / Operator / Value / 多条件）、Active Rules 表（Last Triggered / Status / Actions）、**System Health（Optimal）**、触发统计（24 Active / 3 Triggered）、**Agent 规则建议卡（ASML Margin Alert / Beta Drift + Apply Rule）**。

当前实现：
- ✅ 规则 CRUD + 触发事件（v2 AlertRule union，7 种类型对齐）、AutomationRulesView
- ❌ 无 Agent 规则建议（"Apply Rule" 工作流）、无 System Health 汇总条

### 2.8 Settings
设计稿要素：Connections（Longbridge / Massive 分卡 + Configure/Disconnect）、LLM Configuration（Provider 下拉 + Reasoning Level：Standard/Deep Research）、Compliance（LangSmith Tracing、PII Masking、Clear Cache）、Preferences（Theme/Language&Region）。

当前实现：
- ✅ ConnectionsCenter（provider 分卡）、ModelsTab（LLM 配置）、GeneralTab、EvaluationSettingsTab、诊断页 — **该屏对齐度最高**，仅布局细节（分组标题、卡片层级）与设计稿不同。

### 2.9 Profile & Security
设计稿要素：机构化个人资料（姓名/邮箱/角色/部门）、密码/2FA、API Keys（Revoke）、Active Sessions（设备/IP）、安全评分（65/100）、Security Assistant。

当前实现：
- ✅ ProfileSecurityView（本地工作区健康检查：AI/行情/Skills/Runtime + 健康状态）
- ❌ 设计稿是 SaaS 账户体系（2FA/API Keys/会话管理）；Folio 是 **local-first 桌面应用**，该屏刻意做了本地化改写 — 属于**有意差异**，建议保留现实现（设计稿可作为远期云同步功能的参考）。

### 2.10 Institutional Research Workbench（另一版 Today）
与 2.2 同源，额外有底部 Dock 导航（Today/Markets/Research/Copilot）— 当前用侧栏方案，无需对齐。

### 2.11 两张非 UI 屏（GitHub 抓取 / Research Workbench 早期稿）
为生成素材，不参与对比。

---

## 3. 主要差异清单（按优先级）

| # | 差异 | 影响 | 建议 |
|---|---|---|---|
| 1 | Workbench 缺 **Key Metrics & Valuation（5Y AVG 对比）表** | 高 — 设计稿研究台的核心资产 | 用 `get_financials`/`get_valuation` 渠道补估值表 |
| 2 | 缺 **Target Price / Implied Upside** 卡 | 高 | ResearchReport 头部补目标价区块 |
| 3 | Events 缺 **Impact 分级 / Countdown / Related Assets** | 中高 | `CalendarEvent.data[]` 已有结构化字段可映射 |
| 4 | Portfolio 缺 **Herfindahl/Beta/Sharpe** 指标行 | 中 | core 已有 `portfolio-risk.ts`，补 UI 展示 |
| 5 | Alerts 缺 **Agent 规则建议 + Apply Rule** | 中 | 依赖 LLM 在线；离线时走示例建议 |
| 6 | Watchlist/Pulse 缺 **Signal 列**（MACD/阻力位） | 中 | 需技术指标渠道 |
| 7 | 设计稿三栏固定布局（240/弹性/400） | 低 | 现有布局更符合桌面应用习惯 |
| 8 | `market-up/down`、`provenance-link`、JetBrains Mono 数据字体 token | 低 | 统一 design token 时一并处理 |

> 注：设计稿中的机构化数据（$12.45M / $1.24B 组合、Jane Doe 分析师、公司邮箱/2FA）与 Folio 的个人投资助手定位不符，示例数据已按个人规模（约 $128K 组合）重制，见 §4。

---

## 4. 已落地：未接入 LLM / 行情接口时的默认显示数据（本次变更）

离线（未连接 LongBridge/Massive、未配置 LLM）时，各表面回退到内置示例数据，并统一挂 **"Sample data / 示例数据"** 徽标（`DemoBadge`，tooltip 说明如何接入真实数据源）：

| 表面 | 回退行为 | 代码 |
|---|---|---|
| Watchlist / Today Movers | 单只报价失败 → 该股票的示例 Quote（AAPL/TSLA/NVDA/MSFT/AMZN/GOOGL/META 七只，价格对齐设计稿） | `src/demo/demoData.ts` `demoQuote()` + `fetchQuoteAtom` catch 分支 |
| Portfolio 卡（Today + Portfolio 页） | 快照获取失败或为空 → 个人规模示例组合（4 持仓，市值≈$105K，含成本/浮动盈亏，数字自洽） | `demoPortfolioSnapshot()` + `fetchPortfolioAtom` |
| Upcoming Events（Today + Events 页） | 日历渠道缺失/报错/为空 → 3 条未来事件（财报/宏观/FOMC，日期相对当天生成，永不过期） | `demoCalendarEvents(t)` |
| Market Pulse | `pulse:snapshot` 缺失/失败 → 示例指数/开闭市/温度/涨跌 mover/个人敞口 | `demoPulseSnapshot()` + `loadPulseAtom` |
| Daily Brief | buildBrief 渠道缺失/报错 → 2 条示例简报（风险告警 + 板块轮动），随 locale 翻译 | `demoDailyBrief(t)` |

设计原则：
- **永不混淆**：所有示例数据渲染处均有 `DemoBadge`（`data-testid="demo-badge"`）；错误信息保留在 atom 中（`error`/`failure` 字段），真实数据一旦可用立即覆盖示例。
- **无 demo 数据的代码路径保持诚实**：如 `0700.HK` 等不在示例集内的代码，仍走原空态/错误态。
- **i18n 完整**：`demo` 命名空间 en-US/zh-CN 键位对齐（`i18n:check` 通过）。
- **测试**：新增 `demoData.test.ts`（数值自洽性）、`quoteAtoms` 回退用例；更新 EventsView / DailyBriefSection / MarketPulse 既有用例为新的回退语义。`bun test packages/ui` 259 全绿，`typecheck` 全绿。
