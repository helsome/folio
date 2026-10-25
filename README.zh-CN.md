# Folio

<p align="center">
  <img src="packages/ui/src/assets/folio-logo.png" alt="Folio logo" width="96" />
</p>

<p align="center">
  <a href="README.en.md">English</a> · <a href="README.md">简体中文</a>
</p>

<p align="center">
  <strong>本地优先的 AI 原生投资研究工作台</strong><br />
  研究市场、理解敞口，并把判断留在有证据的报告、投资逻辑和提醒里。
</p>

<p align="center">
  <a href="https://github.com/helsome/folio/releases">发布版本</a> ·
  <a href="docs/architecture.zh-CN.md">系统架构</a> ·
  <a href="docs/PRD.md">产品需求</a>
</p>

> 行情终端告诉你 **What happened**。Folio 的 Agent 用来回答 **Why does this matter to you**，记下 **What did you believe before**，并继续追踪 **What changed**。

## 我们的产品

Folio 是面向公开市场投资者的桌面研究环境。左侧是导航，中间是金融工作区（自选、K 线、财报、新闻、研究报告），右侧常驻一个能看见当前页面和标的的 Agent 副驾驶。选中哪只股票，K 线、概览、研究和 Agent 上下文一起切换。

Folio 本地优先：会话、凭证和研究状态默认留在本机。行情与模型是显式接入的提供方，密钥放在主进程的凭证库里。

> Folio 是研究与决策支持工具，只读。能力注册表里没有下单或交易能力。

当前包版本：`0.4.0-beta.2`。

## 截图

下面的图来自 macOS 上 Folio `0.4.0-beta.2` 的一次真实运行（Electron）。美股报价和日/周 K 线来自 Yahoo Finance，界面标注为延迟行情。这台机器没有安装 Longbridge CLI，因此财报、新闻、盘口等依赖 Longbridge 的区域写明不可用。投资组合和事件页使用应用自带的示例数据，页面上有「示例数据」标记。

### 今日

<p align="center">
  <img src="docs/screenshots/today.jpg" alt="Folio 今日页：资产概览、自选异动、即将到来的事件和右侧 Agent" width="900" />
</p>

<p align="center">
  <em>今日。三栏布局：导航、工作区、Agent。总资产和部分卡片为示例数据；自选里的美股报价来自 Yahoo Finance 延迟行情。快捷入口包括深度研究、复核投资组合和对比个股。</em>
</p>

### 工作台：K 线、概览与新闻

<p align="center">
  <img src="docs/screenshots/kline.jpg" alt="NVDA.US 日 K，均线、成交量，来源为 Yahoo Finance Delayed" width="900" />
</p>

<p align="center">
  <em>K 线。NVDA.US 日 K，带 EMA 与成交量。右上角写明来源「Yahoo Finance · Delayed」。周期可切；Yahoo 提供日 K 和周 K。</em>
</p>

<p align="center">
  <img src="docs/screenshots/overview.jpg" alt="个股概览：示例持仓中的 NVDA 数量与权重" width="49%" />
  <img src="docs/screenshots/news.jpg" alt="新闻视图说明 Longbridge CLI 未安装" width="49%" />
</p>

<p align="center">
  <em>左：报告/概览把行情、持仓和研究放在一起（此处持仓为示例数据）。右：新闻依赖 Longbridge；CLI 未安装时页面写明原因，而不是空白。</em>
</p>

### 深度研究

<p align="center">
  <img src="docs/screenshots/research-running.jpg" alt="深度研究进行中，逐项显示能力取数状态" width="49%" />
  <img src="docs/screenshots/research.jpg" alt="研究完成：部分运行，看空，置信度 55%" width="49%" />
</p>

<p align="center">
  <em>左：研究进行中，逐项显示每个能力的取数状态。右：NVDA.US 综合策略研究结束。16 个计划能力里行情、K 线和公司概况成功，其余因 Longbridge 未安装而失败，状态为部分运行；判断为看空，置信度 55%。</em>
</p>

<p align="center">
  <img src="docs/screenshots/research-report.jpg" alt="研究报告：证据表、立场、摘要，以及保存为投资逻辑" width="720" />
</p>

<p align="center">
  <em>报告正文：证据表（来源、声明、新鲜度、置信度）、立场与摘要，以及「保存为投资逻辑」。</em>
</p>

### 投资逻辑

<p align="center">
  <img src="docs/screenshots/thesis-save.jpg" alt="报告底部保存投资逻辑" width="49%" />
  <img src="docs/screenshots/thesis.jpg" alt="NVDA.US 投资逻辑页：论点、假设与复核状态" width="49%" />
</p>

<p align="center">
  <em>把报告保存为可编辑、可复核的投资逻辑。今日页会提示哪些逻辑该复核。</em>
</p>

### 对比

<p align="center">
  <img src="docs/screenshots/compare.jpg" alt="对比 NVDA、AAPL、TSLA、MSFT 的价格与回报" width="900" />
</p>

<p align="center">
  <em>一次对比 2–4 只标的。价格和 1 个月 / 3 个月 / 1 年回报来自 Yahoo；估值和财务指标在没有 Longbridge 时显示为「—」。对比处于焦点时，Agent 上下文带上这些标的。</em>
</p>

### 机会发现

<p align="center">
  <img src="docs/screenshots/discover.jpg" alt="机会发现：确定性筛选任务，本次候选为 0" width="900" />
</p>

<p align="center">
  <em>17 个确定性筛选任务，覆盖市场异动、基本面、技术面和事件。页面写明规则基于行情数据，不做 AI 扫描。没有候选时给出更换条件、增加自选或检查行情连接的建议。</em>
</p>

### 投资组合

<p align="center">
  <img src="docs/screenshots/portfolio.jpg" alt="投资组合示例数据：配置占比与持仓列表" width="900" />
</p>

<p align="center">
  <em>投资组合（示例数据）：总资产、现金、配置条和持仓。每行可以发起深度研究。底部分析配置、集中度、赫芬达尔指数、大额持仓、回撤和敞口。支持导入持仓。</em>
</p>

### 事件与催化

<p align="center">
  <img src="docs/screenshots/events.jpg" alt="事件与催化剂页面，带示例数据标记" width="900" />
</p>

<p align="center">
  <em>事件与催化剂（示例数据）：财报、宏观数据和央行日历。每条可以带着上下文跳到研究。提醒规则另支持价格、新闻、财报、评级、股息、持仓权重和回撤。</em>
</p>

### Agent 副驾驶

<p align="center">
  <img src="docs/screenshots/agent-running.jpg" alt="Agent 运行中，可以停止" width="49%" />
  <img src="docs/screenshots/source-inspector.jpg" alt="来源检查器列出回答引用的工具数据" width="49%" />
</p>

<p align="center">
  <img src="docs/screenshots/agent.jpg" alt="Agent 回答：工具失败时给出数据缺口说明" width="49%" />
  <img src="docs/screenshots/tool-activity.jpg" alt="工具活动：每次调用的标的、耗时和状态" width="49%" />
</p>

<p align="center">
  <em>Agent 知道当前页面和标的，可切换模型和思考等级，运行中可以停止。这次提问要求查询 NVDA 报价和 K 线；<code>get_quote</code>、<code>get_kline</code>、<code>get_market_status</code> 因 Longbridge CLI 未安装而失败，回答是数据缺口说明，没有编造价格。工具活动和来源检查器可以展开核对每次调用。</em>
</p>

### 技能

<p align="center">
  <img src="docs/screenshots/skills.jpg" alt="技能中心：内置技能、开关和能力数" width="49%" />
  <img src="docs/screenshots/skill-detail.jpg" alt="技能详情：必需和可选能力、就绪状态、参考文件" width="49%" />
</p>

<p align="center">
  <em>技能中心列出内置技能、开关和能力依赖。详情页区分必需/可选能力、就绪状态和参考文件。</em>
</p>

### 评测

<p align="center">
  <img src="docs/screenshots/evaluation.jpg" alt="评测中心概览：folio-agent-v1 fixture 实验" width="49%" />
  <img src="docs/screenshots/evaluation-detail.jpg" alt="实验详情：指标得分和用例运行记录" width="49%" />
</p>

<p align="center">
  <em>评测中心：概览、实验、模型对比、失败模式。图中是本地 fixture 实验 <code>folio-agent-v1</code>（15 次运行），用来查看任务完成、工具选择、证据和时效等维度，不是对外的收益承诺。</em>
</p>

### 设置、连接与个人

<p align="center">
  <img src="docs/screenshots/settings.jpg" alt="设置通用页：Agent 运行时、模型和思考等级" width="49%" />
  <img src="docs/screenshots/settings-llm.jpg" alt="设置 LLM 页：运行时和提供方状态" width="49%" />
</p>

<p align="center">
  <img src="docs/screenshots/settings-connections.jpg" alt="设置连接页：Longbridge 未安装，Yahoo Finance 已连接" width="49%" />
  <img src="docs/screenshots/profile.jpg" alt="个人与安全：工作区健康检查" width="49%" />
</p>

<p align="center">
  <em>设置 → 通用：运行时、当前模型、思考等级和语言。设置 → LLM：提供方状态，密钥不回显。设置 → 连接：Longbridge 未安装、Massive 未连接、Yahoo Finance 已连接（延迟、非官方、个人使用）。个人与安全页汇总本地工作区健康状况。诊断页可复制或导出健康快照。</em>
</p>

### 命令面板

<p align="center">
  <img src="docs/screenshots/cmdk.jpg" alt="⌘K 命令面板列出页面" width="900" />
</p>

<p align="center">
  <em>任意页面按 ⌘K 打开命令面板，搜索页面、标的和操作并跳转。</em>
</p>

## 核心功能

### 研究工作区

- 自选、行情、K 线、财务报表、新闻和证券概览。顶部页签在 K 线 / 财务报表 / 新闻 / 报告之间切换。
- 三栏桌面布局：导航、市场工作区、Agent 副驾驶。
- K 线标注数据来源。Yahoo Finance 路径为延迟美股日 K / 周 K，可叠加均线。
- 数据新鲜度可见。缺失值显示为 `—`，不可用时写明原因（例如 Longbridge CLI 未安装）。

### 深度研究

- 从当前标的发起结构化研究：规划 → 有界并行的能力调用（超时、取消）→ 数据包 → 模型综合 → `ResearchReport`。
- 报告包含立场、置信度、章节、看多论点、看空论点、催化剂、风险，以及每条论断对应的能力执行记录。
- 部分能力失败时仍可生成报告，状态为部分运行，不可用的数据逐项标出。
- 研究有 checkpoint，状态包括排队、取数、综合、完成、部分、失败和取消。
- 八种研究策略：综合、价值、成长、技术、财报、事件驱动、风险复盘、收益。
- 导出支持复制 Markdown、下载 `.md`、复制分享文案、下载分享卡片 `.svg`。
- 同一标的多次研究后，研究差异（Research Diff）对比结论、估值、新风险和置信度变化。

### 投资逻辑

- 从报告保存为可编辑的投资逻辑，记下论点、关键假设和复核状态。
- 有新数据时可以重新评估。今日页列出待复核的逻辑。

### 多标的对比

- 一次放入 2–4 只标的，按估值、成长、利润率、ROE、股息、回报、评级和动量等行对齐。
- 某个提供方没有的字段保持 `—`。Agent 在对比页会带上当前标的集合。

### 机会发现

- 17 个确定性筛选任务，覆盖市场异动、基本面、技术面和事件。筛选是规则，不是模型扫描。
- 候选可以送去研究、对比或加入自选，并带上证据和理由。
- 没有命中时结果就是空的，并提示如何调整范围或检查连接。

### 投资组合与风险

- 总资产、现金、配置、持仓数量、成本和盈亏。持仓行可以进入深度研究，支持导入。
- 组合分析覆盖配置、集中度、赫芬达尔指数、大额持仓、财报、新闻、回撤和敞口。
- 未接入券商账户时，组合页使用内置示例数据，并带「示例数据」标记。示例不会冒充已连接账户。示例集之外的代码保持空态或错误态。

### 提醒与事件

- 提醒规则覆盖价格、新闻、财报、评级、股息、持仓权重和回撤。
- 事件与催化剂页汇总财报、宏观数据和央行日历，一条事件可以带上下文进入研究。
- 今日页汇总组合关注事项、自选异动、提醒、即将到来的事件、近期研究和待复核逻辑。
- 截图中的事件页是示例数据。

### Agent 副驾驶

- Pi Agent 运行时上的持久会话和流式回答。内部综合会话不进入可见对话历史。
- 模型与思考等级、停止/取消、工作区上下文（当前标的、当前视图、选中持仓）。
- Markdown 回答包含标题、列表、表格、链接和代码块。
- 回答下方可展开工具活动（工具名、参数、耗时、成功或失败），并用来源检查器查看引用到的工具数据。
- 工具失败时说明缺口。截图里的行情工具调用在 Longbridge CLI 未安装时失败；同一环境下，工作区和深度研究仍可通过 Yahoo Finance 拿到美股延迟报价和 K 线。

### Agent 如何组织

内核在 Electron 主进程，渲染进程只订阅事件、做视图投影。

- **AgentKernel**：`SessionManager` 持久化会话；`RunManager` 保证同一时间一个 run，并在超时、崩溃或工具失败时收敛。
- **运行时**：`PiRuntimeAdapter` 通过 JSONL / stdio RPC 驱动 Pi；`LocalRuntimeAdapter` 用于确定性路径和测试。
- **会话**：每个 Folio 会话对应一个 Pi 会话文件。工作区上下文随提问传入，不写进长期会话文件。
- **能力注册表**：只读能力的单一事实来源，同时生成 Pi 工具、驱动 UI 是否可用、以及技能就绪。没有交易能力。个人页在本次运行中显示 20 项可用能力。
- **ProviderRouter**：主源加备用，返回带来源的 `ProviderResult`。界面上的「Yahoo Finance · Delayed」来自这条链路。
- **研究综合**：综合阶段基于已取到的数据包写报告，并对进入提示词的外部文本做清洗。
- **凭证**：`CredentialStore` 使用系统 `safeStorage` 加密，密钥不回传渲染进程。
- **技能**：SkillHub 只把技能索引进提示词；Agent 需要时再用 `read_skill_resource` 读取 `SKILL.md` 和参考资料。路径穿越和符号链接逃逸会被拒绝。

### 技能

- 技能声明必需和可选能力。技能中心显示就绪、部分就绪和已禁用。
- 缺少的能力不会被说成可用。

### 评测与可观测性

- 评测中心查看实验、基线、模型对比、失败模式、案例详情和人工反馈。
- 维度包括任务完成、工具选择与参数、证据/来源、时延、失败恢复、研究完整性和决策可用性。
- `folio-agent-v1` 含 86 个案例（黄金路径、困难、长尾、工具失败、回归、对抗）。另有深度研究金标集 `deep-research-gold-v1`。
- 追踪可接 LangSmith 或 Langfuse，默认关闭。隐私级别和 API 密钥在设置中单独管理，界面不回显密钥。
- PR 使用确定性的 `bun run eval:smoke`。完整 benchmark 用 `bun run eval:full`，按需或定时运行。

### 本地优先与只读

- 会话、研究状态和凭证默认在本机。
- Electron：`contextIsolation`、`sandbox`、`nodeIntegration: false`，IPC 按通道白名单。
- 产品路径不提供下单。

## 工作原理

```text
Yahoo Finance / Longbridge / Massive
              │
              ▼
        ProviderRouter
   主源 + 备用，每条数据带来源
              │
              ▼
     Capability Registry（只读）
              │
     ┌────────┼─────────────┐
     ▼        ▼             ▼
  Agent     深度研究        产品 UI
  工具      + 投资逻辑      + 技能
            + 提醒          + 对比
            + 组合风险      + 今日 / 事件
              │
              ▼
       基于证据的报告

主进程 AgentKernel
  SessionManager · RunManager
  PiRuntimeAdapter / LocalRuntimeAdapter
  SkillHub · CredentialStore
```

提供方返回规范化数据和来源，能力暴露类型化操作，产品工作流消费这些契约。

## 数据源与其他集成

- **Yahoo Finance：** 免密钥的美股延迟报价和日/周 K 线备用源，Longbridge 与 Massive 未配置时可用。非官方接口，仅供个人使用。见 [Yahoo Finance 说明](docs/yahoo-finance.zh-CN.md)。
- **Longbridge：** 美股 / 港股 / 内地市场数据以及券商账户的主要连接器。可选。未安装 CLI 时，依赖它的财报、新闻、盘口和券商持仓显示为不可用。终端登录：`longbridge auth login`。
- **Massive：** 已配置时作为美股后备数据源。
- **模型：** Pi 运行时对接已配置的 LLM 提供方，包括 OpenAI 兼容的本地或远程端点。开发与离线黄金路径可以使用确定性本地运行时。
- **桌面端：** Electron，提供 macOS arm64 打包。渲染进程、预加载桥和主进程内核隔离。
- **技能：** 随应用提供的 `SKILL.md` 资源，含引用、启用状态、触发器和能力要求。
- **评测：** 本地 Evaluation Backend，或可选的 LangSmith / Langfuse。工程指标可以和投资结果放在一起看，不把分数说成收益。

## 快速开始

### 面向用户

从[发布页面](https://github.com/helsome/folio/releases)下载最新的 macOS 构建。启动后：

1. 可以直接浏览工作台。未接入的组合、事件等模块显示带「示例数据」标记的内置内容。
2. 在 **设置 → LLM** 配置模型提供方。运行时、默认模型和思考等级在 **设置 → 通用**。
3. 在 **设置 → 连接** 查看数据源。Yahoo Finance 无需 API 密钥，可提供美股延迟报价和 K 线。需要财报、新闻、盘口、港股/A 股或券商持仓时，再连接 Longbridge。
4. 从自选打开一只标的，查看 K 线，或点击 **深度研究**。
5. 按 **⌘K** 搜索页面和标的。

Longbridge 也可以在终端登录：

```bash
longbridge auth login
```

### 面向开发者

前置条件：[Bun](https://bun.sh)。实时 Longbridge 数据需要 [Longbridge CLI](https://open.longbridge.com/longbridge/longbridge-terminal/install)。Pi 运行时需要一个 LLM 提供方；确定性本地运行时不需要外部模型。

> **Windows**：在普通（非管理员）开发终端下，先开启「开发人员模式」（设置 → 系统 → 开发者选项）。否则 Bun 安装 workspace 符号链接依赖时，可能出现 `node_modules` 空目录、缺少 `.bin` 或 `tsc not found`。已有符号链接权限或以提升权限运行的进程不受此限制。

```bash
git clone https://github.com/helsome/folio.git
cd folio
bun install

# 开发模式启动 Electron 渲染进程
bun run dev

# 确定性本地 Agent，不需要外部 LLM
FINAGENT_AGENT_PROVIDER=local bun run dev

# 离线演示：真实提供方不可用时回退到内置示例数据
FINAGENT_AGENT_PROVIDER=local FINAGENT_DEMO_DATA=1 bun run dev
```

### 命令

| 命令 | 说明 |
| --- | --- |
| `bun run dev` | 以开发模式启动 Electron 渲染进程 |
| `bun test` | 运行单元与集成测试 |
| `bun run typecheck` | 对所有工作区包做类型检查 |
| `bun run build` | 构建包、渲染进程、预加载和主进程 |
| `bun run test:e2e` | 运行 Electron 黄金路径 E2E |
| `cd apps/electron && bun run test:typed-blocks` | typed answer blocks 的应用内 Copilot E2E |
| `bun run eval:smoke` | PR 级确定性 Agent 回归评测 |
| `bun run eval:full` | 完整 Agent benchmark |
| `bun run release:check` | 发布门槛检查 |
| `bun run release:package` | 构建 macOS arm64 应用、DMG 和 SHA256 |

打包产物在 `dist/release/`。

## 安全与产品边界

- Electron 使用 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`，以及白名单预加载桥。
- API 密钥和自定义提供方凭证在主进程用 Electron `safeStorage` 加密。渲染进程不能读回明文。日志和追踪默认脱敏。
- Longbridge 命令使用 argv 数组执行、标的校验，并只注册只读能力。
- 技能资源路径拒绝路径穿越和符号链接逃逸。
- 研究报告区分「数据不可用」和负面证据，不编造缺失数字。
- Agent 追踪默认关闭。标准隐私级别会脱敏 prompt、答案、参数和组合工具结果；完整追踪需要显式打开。
- 未签名的本地构建可能触发 macOS 安全提示。签名和公证是发布时的可选步骤。

## 项目状态

Folio 处于测试版，当前包通道为 `0.4.0-beta.2`。仓库包含研究工作区、深度研究、投资逻辑、对比、机会发现、组合与风险、提醒与事件、技能、命令面板，以及设置里的评测中心。

已知限制和发布决策见 [`docs/release-gates.zh-CN.md`](docs/release-gates.zh-CN.md)（[英文](docs/release-gates.md)）和 [`docs/provider-b-decision.zh-CN.md`](docs/provider-b-decision.zh-CN.md)（[英文](docs/provider-b-decision.md)）。

## 路线图

### 近期

- 在同一能力契约下接入更多提供方。
- 更好的报告导航和证据检视。
- 证券工作台的估值对比表（CURRENT vs 5Y AVG）和目标价卡片，见 [`docs/design-comparison.md`](docs/design-comparison.md)。
- 更有用的组合感知研究提示，同时不把内部运行时指令写进用户对话。

### 长期

- 跨平台打包。
- 更多研究策略和结果校准样本。
- 更丰富的定时简报、通知渠道和自定义监控规则。
- 便于贡献者扩展的技能和提供方模型。

## 文档

- [`docs/architecture.zh-CN.md`](docs/architecture.zh-CN.md) — 系统架构与运行时边界 · [English](docs/architecture.md)
- [`docs/PRD.md`](docs/PRD.md) — 产品需求与不变式（中文）
- [`docs/UI-SYSTEM.zh-CN.md`](docs/UI-SYSTEM.zh-CN.md) — 视觉系统与组件规则 · [English](docs/UI-SYSTEM.md)
- [`docs/longbridge-auth.zh-CN.md`](docs/longbridge-auth.zh-CN.md) — Longbridge 认证 · [English](docs/longbridge-auth.md)
- [`docs/longbridge-skill-setup.zh-CN.md`](docs/longbridge-skill-setup.zh-CN.md) — 技能安装与能力覆盖 · [English](docs/longbridge-skill-setup.md)
- [`docs/yahoo-finance.zh-CN.md`](docs/yahoo-finance.zh-CN.md) — Yahoo Finance 延迟行情 · [English](docs/yahoo-finance.md)
- [`docs/release-gates.zh-CN.md`](docs/release-gates.zh-CN.md) — 发布验证清单 · [English](docs/release-gates.md)
- [`docs/EVALUATION.md`](docs/EVALUATION.md) — Agent 评测、可观测性与实验 · [CI 策略](docs/EVALUATION-CI.md) · [基准集](docs/EVALUATION-BENCHMARK.md)
- [`docs/design-comparison.md`](docs/design-comparison.md) — 设计稿与当前实现的逐屏对比

## 常见问题

**没有 Longbridge 账号能用吗？** 能。Yahoo Finance 提供美股延迟报价、日/周 K 线和公司概况。财报、新闻、盘口、港股/A 股和券商持仓需要 Longbridge。

**Agent 会编数据吗？** 工具失败时应当说明缺口。上面的截图里，Longbridge 未安装时行情工具全部失败，回答没有给出价格。

**研究显示「部分运行」是失败了吗？** 不是。失败的能力被标出，报告仍会生成，置信度随之保守。

**API 密钥存在哪？** 主进程用系统 safeStorage 加密。渲染进程只能写入，界面不回显明文。

**截图里的持仓是真仓吗？** 不是。投资组合和事件页标了「示例数据」。自选报价和 K 线是 Yahoo Finance 延迟行情。

## 参与贡献

欢迎 Issue 和 Pull Request。提交前请运行：

```bash
bun test
bun run typecheck
```

UI 改动在布局或交互有实质变化时，请附上截图或简短的视觉说明。
