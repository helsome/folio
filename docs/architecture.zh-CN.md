> 本文是 [architecture.md](architecture.md) 的中文翻译；如有出入，以英文原文为准。

# Finance Agent - 系统架构

## 概览

Folio 是一个 AI 原生的财经工作台：一款桌面应用，将专业的金融工作空间（自选清单、证券头部信息、K 线图、概览、财务报表、新闻）与上下文感知的 Agent 副驾驶（agent copilot）结合在一起。Agent 层构建在持久的 **Agent 内核（Agent Kernel）** 之上：会话（session）、运行（run）和 Agent 事件都是主进程（main process）拥有的一等实体，通过 IPC 流式传输到 UI，并持久化到磁盘，因此应用可以重启而不丢失对话状态。

---

## 1. 架构总览

```
Workbench Shell (Allotment: Sidebar | Finance Workspace | Agent Panel)
      │
      ▼
Renderer atoms (view cache): activeSymbol / activeView / llmState
      │  IPC (whitelisted: kernel:*, sessions:*, runs:*, agent:*, market:*,
      │        llm:*, skills:*, alerts:*, longbridge:*)
      ▼
AgentKernelHost (main process)
      │
      ├── AgentKernel
      │     ├── SessionManager (persistence + lifecycle)
      │     ├── RunManager (run lifecycle + event broadcast)
      │     └── AgentRuntime
      │           ├── PiRuntimeAdapter ──► Pi Runtime (JSONL/stdio)
      │           │      ├── run → promptStreaming (workspace context + skill index)
      │           │      └── LlmRuntimeApi (listModels / setModel / thinking / test)
      │           └── LocalRuntimeAdapter (deterministic / tests)
      │
      ├── MarketDataService (UI + Agent share one data layer)
      ├── CredentialStore (safeStorage-encrypted, main process only)
      └── SkillHub V2 (SKILL.md packages + references, progressive loading)
      │
      ▼
AgentEvent Stream (run_started … run_completed)
      │
      ▼
Electron IPC ('agent:event' push channel)
      │
      ▼
React UI (Jotai atoms as view cache only)
```

内核运行在 Electron **主进程** 中。渲染进程从不直接写入会话、运行或消息；它从内核水合（hydrate）数据，并将事件流投影到 Jotai 状态。

---

## 2. 进程架构

| 进程 | 职责 |
|---------|----------------|
| **主进程** | `AgentKernel`（SessionManager + RunManager + runtime）、IPC 接口面、行情数据、提醒 |
| **预加载** | 白名单化的 `contextBridge` API（`window.electronAPI`） |
| **渲染进程** | React UI；订阅 `agent:event`，调用内核 IPC（`sessions:*`、`runs:*`） |

安全边界保持不变并强制执行：

```typescript
new BrowserWindow({
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    preload: path.join(__dirname, '../preload/index.cjs'),
  },
});
```

渲染进程无法访问 `fs`、`child_process`、数据库或 Pi runtime。

---

## 3. 领域模型

所有类型都位于 `@finagent/core`：

```
Session          ← persisted conversation scope (id, title, status, runtimeSessionPath, recentSymbols)
  ├── Messages   ← visible transcript (user / assistant), persisted per session
  └── Runs       ← one agent execution per user message
        └── AgentEvents ← unified event protocol (streamed, not persisted)
              └── ToolCalls ← live tool state inside events
```

### AgentEvent 协议

```ts
type AgentEvent =
  | run_started       { run, userMessage }
  | message_started
  | message_delta     { delta, answer }
  | message_completed { answer }
  | tool_started      { toolCall }
  | tool_completed    { toolCall }
  | run_completed     { answer, toolCalls }
  | run_failed        { error }
```

每个事件都携带 `id`、`sessionId`、`runId`、`timestamp`、`sequence`。Pi 特有的事件形态永远不会跨过内核边界：原始 Pi JSONL 事件由 `PiRuntimeAdapter` 中的 `PiEventAdapter` 转换。

---

## 4. Agent 内核

`packages/shared/src/kernel/`：

| 组件 | 职责 |
|-----------|----------------|
| `SessionManager` | 创建/列出/删除会话，持久化消息，维护会话元数据统计，为每个会话分配一个 runtime 会话文件路径 |
| `RunManager` | 启动运行（持久化用户消息 + 运行记录），驱动 runtime 事件流，向订阅者广播事件，持久化最终的助手消息 + 运行结果，保证每个运行都会收敛（completed / failed / cancelled） |
| `AgentKernel` | 组合根；持有 `SessionManager`、`RunManager` 和 runtime 适配器 |

RunManager 不变量：

- 同一时间只有一个运行在执行（Pi runtime 一次只处理一个 prompt）；第二次调用 `startRun` 会以 `RUN_IN_PROGRESS` 失败。
- `cancelRun` 标记该运行并调用 `runtime.cancel()`；运行以 `cancelled` 结束（若 runtime 已完成则为 `completed`）。
- 超时、runtime 崩溃、工具失败和格式错误的协议输出都会结束运行——没有任何运行能永远停留在 `running` 状态。

### AgentRuntime 抽象

`@finagent/core` 定义了与提供商无关的 runtime 契约：

```ts
interface AgentRuntime {
  getTools(): Promise<ApiResult<ToolDefinition[]>>;
  ensureSession({ id, title?, sessionPath?, recentSymbols? }): Promise<RuntimeSession>;
  run({ sessionId, runId, content, workspaceContext? }): AsyncIterable<AgentEvent>;
  cancel({ sessionId, runId }): Promise<void>;
  disposeSession?(sessionId): Promise<void>;
  dispose(): Promise<void>;
}
```

`workspaceContext` 携带渲染进程当前关注的金融对象（`activeSymbol`、`activeView`、`selectedPosition`）——即临时的 Workspace 上下文，刻意与会话（对话）状态分离。它从不被持久化。

## 5. Pi Runtime 适配器

`packages/shared/src/agent/`：

| 组件 | 职责 |
|-----------|----------------|
| `PiRpcClient` | JSONL/stdio 传输：`prompt`、`promptStreaming`（实时原始事件）、`switchSession`、`getState`、`getAvailableModels`、`setModel`、`setThinkingLevel`、`restart`、`abortCurrentPrompt`、健康检查、超时、进程重启 |
| `PiEventAdapter` | 每次运行的纯 Pi 事件 → AgentEvent 映射 |
| `PiRuntimeAdapter` | `AgentRuntime` 实现：Folio 会话 ↔ Pi 会话文件生命周期、prompt 构造（工作空间上下文 + 渐进式技能索引）、标的记忆，以及 `LlmRuntimeApi` 控制面 |

### 会话隔离与恢复

Folio 会话与 Pi 对话是稳定的 1:1 映射：

```
Folio Session A ──► <userData>/pi-sessions/<sessionA>.jsonl
Folio Session B ──► <userData>/pi-sessions/<sessionB>.jsonl
```

所有会话共享一个 Pi 进程；runtime 通过 `switch_session` RPC 命令切换对话。JSONL 会话文件是 Pi 自己的持久化对话存储，因此：

- 会话隔离：每个 Folio 会话都有自己的 Pi 会话文件——不会发生跨会话上下文污染。
- 恢复：`switch_session` 重新加载文件，恢复完整对话。
- 重启恢复：会话文件在应用重启后依然存在；`runtimeSessionId` 通过 `get_state` 刷新，并存储在 Folio 会话上。

### 事件流水线

```
Pi stdout (JSONL)                       tool_execution_start / tool_execution_end /
                                        message_update(text_delta) / agent_end / error
        │
        ▼
PiRpcClient.promptStreaming()           live raw events + aggregated result
        │
        ▼
PiEventAdapter.consume()                AgentEvent sequence (tool_started,
                                        message_delta, run_completed, …)
        │
        ▼
PiRuntimeAdapter.run()                  AsyncIterable<AgentEvent>
        │
        ▼
RunManager                              broadcast → IPC → UI; persistence
```

## 6. 本地 Runtime

`LocalRuntimeAdapter` 将 `LocalFinanceAgentBackend` 包装进 `AgentRuntime` 契约，使得完整的“会话 → 运行 → 事件 → UI”循环无需 Pi 进程即可工作，也用于测试。工具调用以后端自身记录的形式重放为开始/结束事件；取消是尽力而为的（在当前工具调用结束时生效）。会话上下文（最近标的）持久化在会话上，并在重启时恢复。

## 7. 持久化

`packages/shared/src/storage/` —— 原子 JSON 文件存储，带仓储抽象（可替换为 SQLite）：

| 仓储 | 文件 | 内容 |
|------------|------|----------|
| `SessionRepository` | `sessions.json` | 会话元数据索引（`SessionMeta`，含 `messageCount`、`runtimeSessionPath`） |
| `MessageRepository` | `sessions/<id>/messages.json` | 可见对话记录 |
| `RunRepository` | `sessions/<id>/runs.json` | 运行历史 |

存储根目录：`<userData>/store`；Pi 会话文件：`<userData>/pi-sessions`。写入是原子的（临时文件 + 重命名）。渲染进程从不持久化任何内容——Jotai atoms 只是启动时从内核水合的视图缓存。

## 8. IPC 接口面

| 通道 | 方向 | 用途 |
|---------|-----------|---------|
| `kernel:hydrate` | invoke | 启动时的会话列表 |
| `sessions:create` / `sessions:delete` | invoke | 会话生命周期 |
| `sessions:getMessages` / `sessions:listRuns` | invoke | 惰性加载的对话记录 / 运行历史 |
| `runs:start` (`{sessionId, content, workspaceContext?}`) / `runs:cancel` | invoke | 运行生命周期 |
| `agent:event` | push | 向渲染进程推送实时 AgentEvent 流 |
| `agent:getTools` | invoke | 工具定义 |
| `market:getQuote` / `getKline` / `getPortfolio` / `getStaticInfo` / `getCalcIndex` / `getMarketStatus` / `getNews` | invoke | 行情数据（UI 与 Agent 共享此数据层） |
| `llm:getState` / `listModels` / `setModel` / `listThinkingLevels` / `setThinkingLevel` | invoke | LLM 控制面（Pi 模型注册表） |
| `llm:getProviders` / `listCredentials` / `setCredential` / `removeCredential` | invoke | 提供商状态 + 凭据（机密信息绝不会通过 IPC 传回渲染进程） |
| `llm:setCustomProvider` / `removeCustomProvider` / `testProvider` | invoke | OpenAI 兼容的自定义提供商 + 连接测试 |
| `skills:list` / `setEnabled` / `listResources` / `readResource` | invoke | SkillHub V2 接口面 |
| `longbridge:getStatus`、`alerts:load` / `alerts:save` | invoke | 状态与提醒 |

所有处理程序都用 `{ ok, data | error }` 信封（`toIpcResult`）包装结果。

## 9. 状态管理

- 会话列表：`sessionsAtom`（从内核水合）。
- 消息：每个会话一个 `messagesAtomFamily`，从内核惰性加载。
- 工作空间上下文：`activeSymbolAtom`（当前关注证券的唯一事实来源）、`activeViewAtom`、`navSectionAtom`、`agentPanelVisibleAtom`，以及派生的 `workspaceContextAtom`——UI 侧的 Jotai 状态，与会话状态相区分。
- LLM 控制面：`llmStateAtom` + `llmModelsAtom`/`llmProvidersAtom` 视图缓存，通过 `llm:*` IPC 从 Pi 注册表水合。
- 运行：`runViewAtom` + `applyAgentEventAtom` reducer——`agent:event` 流的纯投影。`run_started` 展示用户消息；`tool_started`/`tool_completed` 驱动实时工具列表；`message_delta` 流式输出回答；终止事件定稿助手消息并清空运行视图。
- `KernelBridge` 组件在挂载时水合数据并订阅事件流。

## 10. 安全架构

- `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。
- IPC 在 preload 中逐通道白名单化（源码 `index.ts`、运行时 `index.cjs`，通过 `bun run build:preload` 构建）。
- **CredentialStore**：API 密钥和自定义提供商配置在静态存储时用 Electron `safeStorage` 加密（`<userData>/credentials.json`）。渲染进程只能一次性发送机密信息，之后只收到元数据。机密内容会从错误、日志和追踪中脱敏（`redactSecrets`）。
- 提供商覆盖项按“主进程 → Pi 的 spawn 环境（`FINAGENT_PROVIDER_OVERRIDES`）→ finagent 扩展的 `registerProvider`”流动——这是 Folio 自有的配置，绝不触碰用户的全局 Pi 配置。凭据变更会重启 Pi 子进程（会话不受影响）。
- LongBridge 访问保持在 `longbridge-tools` 之后（参数化的 execa 数组参数、标的校验）。
- 技能资源通过路径安全的加载器读取（`SkillHub.readSkillResource` / `read_skill_resource` 工具）：绝对路径、`..` 穿越和符号链接逃逸都会被拒绝。
- 渲染进程无法直接触达 `fs`、数据库、Pi 进程或 LongBridge CLI。
---

## 11. 组件地图

```
finagent/
├── packages/
│   ├── core/                  # Types only: capability/research/thesis/alert-rule/
│   │                          #   readiness/compare/portfolio-risk contracts +
│   │                          #   kernel types (Session, Run, AgentEvent, …)
│   ├── shared/
│   │   ├── providers/          # V4 provider platform: ProviderRouter (primary
│   │   │                      #   + fallback), registry, ConnectionStore,
│   │   │                      #   Longbridge financial-data + broker adapters,
│   │   │                      #   Massive (Polygon.io) fallback adapter, health
│   │   ├── diagnostics/        # Collector, redaction, support-bundle export,
│   │   │                      #   error ring buffer
│   │   ├── capabilities/      # Finance Capability Registry (single source of
│   │   │                      #   truth): manifests (phase-one + phase-two),
│   │   │                      #   registry, executor (concurrency/timeout/abort),
│   │   │                      #   Pi tool adapter, skill readiness
│   │   ├── research/          # Deep Research: planner, runner, synthesizers
│   │   │                      #   (agent-backed + deterministic local), repository
│   │   ├── thesis/            # InvestmentThesis: repository, converter,
│   │   │                      #   impact evaluators, service (re-evaluate)
│   │   ├── compare/           # Structured symbol comparison
│   │   ├── alerts/            # Alert Engine v2: rule repository (v1 migration),
│   │   │                      #   per-type evaluators, scheduler, event log
│   │   ├── portfolio-risk/    # Allocation/concentration/signals + synthesizer
│   │   ├── agent/             # PiRpcClient, adapters, LocalFinanceAgentBackend,
│   │   │                      #   FinanceToolRegistry (capability-backed), MarketDataService
│   │   ├── kernel/            # SessionManager, RunManager, AgentKernel
│   │   ├── resources/         # ResourceLocator (dev repo vs packaged resourcesPath)
│   │   └── storage/           # JsonFileStore, Session/Message/RunRepository
│   ├── ui/                    # React app: atoms (workspace/research/thesis/compare/
│   │   │                      #   portfolio-risk/alert/skill-readiness/…),
│   │   │                      #   layout, workspace, chart, agent, settings,
│   │   │                      #   research/thesis/compare/portfolio components, client
│   ├── pi-extension/          # Pi tools GENERATED from the capability registry
│   │                          #   (+ skill-resource tools) + provider overrides
│   ├── longbridge-tools/      # LongBridge CLI wrapper: 20+ fetchers, parsers,
│   │                          #   typed results, real-CLI test fixtures
│   └── skill-hub/             # SkillHub V2: SKILL.md packages + references,
│                              #   path safety, enable/disable, capability map
├── skills/                    # Vendored official Longbridge skills (MIT)
└── apps/electron/
    ├── src/
    │   ├── main/              # index.ts (IPC), kernelHost.ts (V3 wiring:
    │   │                      #   registry, services, alert engine, notifications),
    │   │                      #   credentialStore.ts, loadEnv.ts
    │   ├── preload/           # contextBridge API (source index.ts, built index.cjs)
    │   └── renderer/          # React entry, finagentClient
    └── e2e/                   # Golden-path A–H (run.mjs) + packaged smoke
```

## 11.1 能力层（V4）

```
Longbridge CLI / Massive API ─► provider adapters (FinancialDataProvider,
                                   BrokerAccountProvider — neutral domains)
                                              │
                                    ProviderRouter (primary + fallback)
                                              │
                          ProviderResult { data, provenance{providerId, …} }
                                              │
                          Capability Registry (20 caps, router-backed fetchers)
                       ┌────────────────────┴──────────────────────┐
                       │                    │                       │
             Pi tools (generated)   UI availability +       Product workflows:
             via pi-extension        Skill Readiness          research / thesis /
                                                                alerts / compare /
                                                                portfolio risk
```

每个能力清单（capability manifest）声明 id/name/description/category/risk/auth、一个 TypeBox 输入 schema，以及一个返回 `{ data, provenance, summary }` 的 `execute`。`defineCapability` 用输入校验包装 execute。`CapabilityExecutor` 在超时/中止约束下运行能力，并按能力隔离失败——研究、重新评估、提醒、对比和风险都经由它执行。所有能力都是只读的（`riskLevel: 'read'`）；不存在下单/交易能力。

业务层（research/agent/UI/portfolio/compare）从不导入供应商包：它们消费能力结果，其来源（provenance）标明实际回答的提供商。Longbridge 和 Massive（Polygon.io，fallback）是 V4 中的两个适配器；路由器是唯一的桥（spec §4）。

## 12. 数据流 — 工作空间查询

```
User: clicks NVDA.US in the watchlist
    ↓
activeSymbolAtom = NVDA.US (single source of truth)
    ↓
SecurityHeader / Overview / Chart / News / AgentPanel context chip all follow
    ↓
User: "最近走势怎么样？" → AgentPanel input
    ↓
client.kernel.startRun(sessionId, content, workspaceContext)
    ↓
RunManager.startRun() → AgentRuntime.run({…, workspaceContext})
    ↓
PiRuntimeAdapter builds the prompt: workspace context + skill metadata index
    → Pi prompt (the agent loads relevant SKILL.md/references via
      read_skill_resource when needed)
    ↓
tool_started / tool_completed / message_delta … (AgentEvent stream)
    ↓
IPC 'agent:event' → KernelBridge → run reducer → ToolActivity + streaming answer
    ↓
run_completed (or run_failed / cancelled) → answer persisted to the transcript
```

应用重启：`kernel:hydrate` 恢复会话列表，`sessions:getMessages` 恢复对话记录，Pi 会话文件恢复运行时对话上下文（包括会话的模型和思考级别，通过 `get_state`）。
