# Finance Agent - PRD 设计文档

> **版本历史**
> - v0.1.0 (2026-05-05) 初始版本
> - v0.2.0 (2026-05-05) 合并双审查员反馈，修复安全问题和完善验收标准
> - v0.3.0 (2026-05-05) 新增 Skill Hub 架构，支持可扩展的技能系统
> - v0.4.0 (2026-05-05) 强化 Skill 可自定义性，前端实时编辑所有 Skills
> - v0.5.0 (2026-05-05) 完善 Skill Hub 生态系统，支持 Tool/Prompt/Hybrid 三种类型

---

## 1. 产品概述

### 1.1 产品定位

**产品名称**：Finance Agent（代号 finagent）

**定位**：个人投资助手 — 整合行情数据、组合管理、告警提醒、信息聚合于一体的 AI 驱动桌面应用

**目标用户**：个人投资者，需要便捷地获取市场数据，分析投资组合、设置智能提醒

**核心差异化**：
- AI 对话交互降低使用门槛，无需记忆命令行参数
- 多步推理场景："帮我看看持仓中近一年涨幅超过50%的股票"
- 自然语言数据查询："比较茅台和五粮液的PE"
- 智能解读："解释一下为什么这支股票突然下跌"
- **Skill Hub 扩展系统**：用户可自定义和调整所有 AI 行为

### 1.2 技术选型

| 层级 | 技术方案 | 说明 |
|------|----------|------|
| 桌面框架 | Electron 39 + electron-builder | 跨平台桌面应用 |
| 前端框架 | React 18 + Vite 6 | 快速开发 HMR |
| 状态管理 | Jotai 2.x (atomFamily) | Session 隔离 |
| 样式方案 | Tailwind CSS v4 + OKLCH | 现代 CSS |
| AI 后端 | Pi Agent Framework | 轻量级 AI Coding Agent |
| 数据源 | LongBridge CLI | 用户自安装，非硬编码 |
| 通信协议 | MCP (Model Context Protocol) | AI 工具扩展标准 |
| **Skill 系统** | **SkillHub** | **可扩展的技能注册与自定义** |

---

## 2. 功能需求

### 2.1 功能矩阵

| 功能模块 | 功能点 | 优先级 | 备注 |
|----------|--------|--------|------|
| **行情查询** | 实时报价 | P0 | quote 命令 |
| | K线数据 | P0 | kline 命令 |
| | 分钟线 | P0 | intraday 命令 |
| | 历史数据 | P0 | kline 支持历史区间 |
| **财务数据** | PE/PB 等指标 | P0 | calc-index, valuation |
| | 分红信息 | P0 | dividend |
| **组合管理** | 持仓查询 | P0 | positions |
| | 盈亏分析 | P0 | portfolio 含 P/L |
| | 账户资产 | P0 | assets, cash-flow |
| **价格告警** | 涨跌幅阈值 | P1 | alert 命令 |
| **持仓告警** | 持仓股异动 | P1 | 持仓监控 |
| | 财报发布提醒 | P1 | calendar events |
| **新闻资讯** | 财经新闻聚合 | P1 | news 命令 |
| **研报复视** | 分析师评级汇总 | P2 | institution-rating |
| | 目标价 | P2 | target price |

### 2.2 Skill 系统概述

**核心理念**：将所有 AI 能力抽象为 Skills，支持热插拔和前端自定义

#### Skill 类型

| 类型 | 说明 | 示例 |
|------|------|------|
| **Tool Skill** | 调用外部工具/命令 | `get_quote`, `get_portfolio` |
| **Prompt Skill** | 定义提示词模板 | `market_analysis`, `stock_explain` |
| **Hybrid Skill** | 工具 + 提示词组合 | `fundamental_analysis` |

#### Skill 结构

```typescript
interface Skill {
  id: string;              // 唯一标识
  name: string;            // 显示名称
  type: 'tool' | 'prompt' | 'hybrid';

  // 触发条件
  trigger: {
    keywords?: string[];    // 触发关键词
    pattern?: RegExp;       // 正则匹配
    always?: boolean;       // 始终启用
  };

  // 工具定义（可选）
  tool?: {
    command: string;       // 执行命令
    parameters: Parameter[]; // 参数定义
    validator?: string;     // 参数验证正则
  };

  // 提示词定义（可选）
  prompt?: {
    system?: string;        // System prompt
    user?: string;          // User prompt template
    examples?: Example[];    // Few-shot examples
  };

  // 元数据
  metadata: {
    description: string;
    author: string;
    version: string;
    tags: string[];
    enabled: boolean;       // 用户可切换
    editable: boolean;      // 用户可编辑
  };
}
```

### 2.3 前端 Skill 自定义

**核心特性**：所有加载的 Skills 都在前端暴露，支持实时编辑和自定义

#### Skill Hub UI

**入口**：左侧边栏 "Skills" 标签

**界面功能**：

| 标签 | 功能 |
|------|------|
| **工具** | 列出所有 Tool Skills，可启用/禁用 |
| **提示词** | 编辑 Prompt Skills，可自定义文案 |
| **商店** | 浏览/安装社区 Skills |
| **已安装** | 管理已安装的 Skills |

#### Skill 编辑器

```
┌─────────────────────────────────────────────────────────────┐
│  编辑 Skill: market_summary                          [保存] [取消] │
├─────────────────────────────────────────────────────────────┤
│  类型: [Prompt Skill ▼]                                    │
│  触发关键词: [市场, 概览, summary]                          │
│                                                              │
│  System Prompt:                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 你是一个专业的金融市场分析师。                          │   │
│  │ 请用简洁易懂的语言总结市场动态。                       │   │
│  │ 重点关注: 涨跌家数、成交量、北向资金等指标              │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
│  预设风格: [简洁] [详细] [技术分析] [自定义]                 │
│                                                              │
│  [预览] [重置默认] [导出]                                   │
└─────────────────────────────────────────────────────────────┘
```

#### 内置 Prompt Skills（用户可编辑）

| Skill | 用途 | 默认 System Prompt |
|-------|------|-------------------|
| `market_summary` | 市场概览总结 | "你是一个专业的金融市场分析师。请用简洁易懂的语言总结市场动态。重点关注: 涨跌家数、成交量、北向资金等指标" |
| `stock_explain` | 股票分析解释 | "你是一个专业的股票分析师。请从技术面和基本面分析股票走势。用数据支撑你的观点。" |
| `alert_notification` | 告警通知文案 | "你是一个金融助手。当触发告警时，用友好且专业的方式通知用户。" |
| `error_message` | 错误提示文案 | "你是一个金融助手。当发生错误时，用友好且专业的方式解释问题。" |
| `price_alert_trigger` | 触发条件判断 | "当股价达到阈值时，判断是否需要触发告警。考虑波动性和成交量。" |

#### 自定义流程

1. 用户在 Skill Hub 选择要编辑的 Skill
2. 打开 Skill 编辑器，修改 Prompt 内容
3. 实时预览修改效果
4. 保存后立即生效，无需重启
5. 用户可重置为默认值

### 2.4 用户故事

#### 场景 1：查询股票报价
```
作为 用户
我希望 能够通过对话查询股票实时报价
以便于 快速了解持仓股动态
```

**实现方式**：
- Skill: `get_quote` (Tool Skill)
- 用户输入触发关键词 → 执行 `longbridge quote` → 格式化返回

**验收条件**：
- 正常：输入股票代码，2秒内返回价格、涨跌幅、成交量
- 异常：网络断开时，显示"网络不可用，请检查网络连接"，提供重试按钮
- 异常：代码不存在时，显示"未找到股票 XXX，请检查代码是否正确"

#### 场景 2：自定义 AI 分析风格
```
作为 用户
我希望 能够调整 AI 的分析风格和提示词
以便于 获得更符合我需求的解读
```

**实现方式**：
- Skill: `stock_analysis` (Prompt Skill)
- 用户在 Skill Hub 中编辑 system prompt
- 修改立即生效，无需重启

**验收条件**：
- 正常：用户可编辑所有 Prompt Skills 的 system prompt
- 正常：提供预设风格（简洁、详细、技术分析）
- 异常：格式错误时，显示验证提示

#### 场景 3：调整告警通知文案
```
作为 用户
我希望 能够自定义告警通知的语气和内容
以便于 更符合我的偏好
```

**实现方式**：
- Skill: `alert_notification` (Prompt Skill)
- 用户编辑通知文案模板
- 保存后立即生效

**验收条件**：
- 正常：用户可自定义告警文案风格
- 正常：支持变量替换（$symbol, $price, $change）
- 异常：格式错误时，显示验证提示

#### 场景 4：启用/禁用 Tool Skills
```
作为 用户
我希望 能够选择启用哪些 Tools
以便于 根据需要精简 AI 能力
```

**实现方式**：
- Tool Skills 都有 enabled 开关
- 禁用的 Skills 不注册到 Pi Agent
- 状态持久化到 manifest

**验收条件**：
- 正常：点击开关，Skill 立即启用/禁用
- 异常：禁用后 AI 无法调用该工具

#### 场景 5：安装社区 Skill
```
作为 用户
我希望 能够从社区安装新的 Skills
以便于 扩展应用功能
```

**实现方式**：
- 内置 Skill Hub 应用市场
- 支持从 URL/文件导入 Skill
- Skill 存储在 `~/.finagent/skills/`

**验收条件**：
- 正常：可浏览可用 Skills 列表
- 正常：一键安装，Skills 出现在工具列表
- 异常：安装失败时，显示错误原因

---

## 3. 系统架构

### 3.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                         ELECTRON LAYER                                   │
│  ┌───────────────────────────────────────────────────────────────────┐     │
│  │                     RENDERER PROCESS                                  │     │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                │     │
│  │  │  AppShell   │  │    Jotai   │  │   Tailwind  │                │     │
│  │  │   Layout    │  │    State   │  │   CSS v4    │                │     │
│  │  └─────────────┘  └─────────────┘  └─────────────┘                │     │
│  │                                                                     │     │
│  │  ┌─────────────────────────────────────────────────────────────┐   │     │
│  │  │              React Components                                  │   │     │
│  │  │  AppShell | TopBar | SkillHub | MainContent | RightPanel    │   │     │
│  │  └─────────────────────────────────────────────────────────────┘   │     │
│  └───────────────────────────────────────────────────────────────────┘     │
│                               │ IPC (contextBridge)                         │
│  ┌───────────────────────────────────────────────────────────────────┐     │
│  │                      MAIN PROCESS                                      │     │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                │     │
│  │  │   Window     │  │   Alert     │  │   Skill     │                │     │
│  │  │  Manager    │  │   Engine   │  │   Hub       │                │     │
│  │  └─────────────┘  └─────────────┘  └─────────────┘                │     │
│  └───────────────────────────────────────────────────────────────────┘     │
│                               │ JSONL RPC (stdio)                           │
│  ┌───────────────────────────────────────────────────────────────────┐     │
│  │                      PI AGENT BACKEND                                  │     │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                │     │
│  │  │    AI      │  │   Skill     │  │   Skill     │                │     │
│  │  │   Loop     │  │  Registry   │  │   Loader   │                │     │
│  │  └─────────────┘  └─────────────┘  └─────────────┘                │     │
│  └───────────────────────────────────────────────────────────────────┘     │
│                               │ execa (安全参数化)                         │
│  ┌───────────────────────────────────────────────────────────────────┐     │
│  │                    LONGBRIDGE CLI LAYER                                │     │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                │     │
│  │  │    which   │  │   execa    │  │   parse    │                │     │
│  │  │  (检测)    │  │   (执行)    │  │   (解析)    │                │     │
│  │  └─────────────┘  └─────────────┘  └─────────────┘                │     │
│  └───────────────────────────────────────────────────────────────────┘     │
│                               │                                             │
│                    ┌──────────┴──────────┐                              │
│              ┌─────┴─────┐        ┌─────┴─────┐                         │
│              │ longbridge│        │  Local    │                         │
│              │    CLI   │        │  Storage  │                         │
│              │ (用户安装)│        │  Skills   │                         │
│              └───────────┘        └───────────┘                         │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 Skill Hub 架构

```
┌─────────────────────────────────────────────────────────────┐
│                    SKILL HUB SYSTEM                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐           │
│  │   Built-in │  │   User     │  │  Community │           │
│  │   Skills   │  │  Skills   │  │   Skills   │           │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘           │
│         │                  │                  │               │
│         └──────────────────┼──────────────────┘               │
│                            ▼                                  │
│                 ┌──────────────────┐                        │
│                 │   Skill Loader   │                        │
│                 │   (热加载/卸载)  │                        │
│                 └────────┬─────────┘                        │
│                          ▼                                  │
│                 ┌──────────────────┐                        │
│                 │   Skill Store   │                        │
│                 │  (内存中的 Skills)│                        │
│                 └────────┬─────────┘                        │
│                          ▼                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                  Pi Agent Registry                    │   │
│  │  • Tools: registerTool()                            │   │
│  │  • Prompts: 注入到 System Prompt                    │   │
│  │  • Triggers: 关键词/正则匹配                        │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 3.3 Skill 存储结构

```
~/.finagent/
├── skills/                    # 用户安装的 Skills
│   ├── get-quote/           # Skill 目录
│   │   ├── SKILL.json       # Skill 定义
│   │   └── README.md        # 文档
│   ├── market-analysis/
│   └── community/
│       ├── stock-screener/
│       └── technical-analysis/
├── config/
│   └── skills-manifest.json  # 已启用的 Skills 列表
└── sessions/                # 对话会话
```

### 3.4 安装流程

```
┌─────────────────────────────────────────────────────────────┐
│                  FIRST LAUNCH FLOW                           │
├─────────────────────────────────────────────────────────────┤
│  App 启动                                                      │
│       ↓                                                      │
│  检测 longbridge 是否安装 (which 命令)                        │
│       ↓                    ↓                               │
│  [未安装]              [已安装]                           │
│       ↓                    ↓                               │
│  显示 Setup Wizard     加载 Skill Hub                       │
│  - 安装说明           - 加载内置 Skills                    │
│  - 执行 auth login    - 加载用户 Skills                    │
│  - 测试连接           - 注册到 Pi Agent                    │
└─────────────────────────────────────────────────────────────┘
```

### 3.5 LongBridge CLI 调用模式

**核心原则**：LongBridge CLI 是用户环境依赖，app 不打包此工具

```typescript
import { execa } from 'execa';

// 检测工具是否可用
async function checkLongBridgeInstalled(): Promise<boolean> {
  try {
    await execa('which', ['longbridge']);
    return true;
  } catch {
    return false;
  }
}

// 执行 longbridge 命令（安全参数化，无 Shell 注入风险）
async function execLongBridge(args: string[]): Promise<string> {
  const installed = await checkLongBridgeInstalled();
  if (!installed) {
    throw new Error('LONGBRIDGE_NOT_INSTALLED');
  }

  try {
    const { stdout, stderr } = await execa('longbridge', [...args, '--format', 'json'], {
      timeout: 10000,
    });

    if (stderr && !stdout) {
      throw new Error(`LongBridge Error: ${stderr}`);
    }

    return stdout;
  } catch (error) {
    if (error.message.includes('ENOENT')) {
      throw new Error('LONGBRIDGE_NOT_INSTALLED');
    }
    if (error.message.includes('timed out')) {
      throw new Error('LONGBRIDGE_TIMEOUT');
    }
    throw error;
  }
}
```

**安全设计要点**：
- 使用 `execa` 数组参数形式，避免 shell 注入
- 命令执行设置 10 秒超时
- stderr 错误处理
- Token 生命周期管理（启动时验证，过期后引导重新登录）

---

## 4. 模块设计

### 4.1 Electron Main Process

| 模块 | 职责 | 安全配置 |
|------|------|---------|
| `WindowManager` | 窗口创建、生命周期管理 | - |
| `AlertEngine` | 后台告警检查、触发通知 | 最小化时通过 Tray 运行 |
| `CacheLayer` | 热点数据本地缓存 | 缓存过期策略：行情 30s，财务数据 5min |
| `IPCHandler` | 与 Renderer 通信 | 白名单 IPC 通道 |
| `SkillHub` | Skill 加载、存储、注册 | Skill 隔离、验证 |

### 4.2 Pi Agent Extension

#### 内置 Tool Skills

| Skill | 命令 | 功能 |
|-------|------|------|
| `get_quote` | `longbridge quote` | 实时报价 |
| `get_kline` | `longbridge kline` | K线数据 |
| `get_portfolio` | `longbridge portfolio` | 投资组合 |
| `get_positions` | `longbridge positions` | 持仓列表 |
| `get_news` | `longbridge news` | 新闻资讯 |
| `create_alert` | `longbridge alert` | 创建告警 |
| `get_financial` | `longbridge financial-report` | 财报数据 |
| `get_rating` | `longbridge institution-rating` | 分析师评级 |

#### 内置 Prompt Skills

| Skill | 用途 | 可自定义 |
|-------|------|---------|
| `market_summary` | 市场概览的总结风格 | ✅ |
| `stock_explain` | 股票分析的解释方式 | ✅ |
| `alert_notification` | 告警通知的文案风格 | ✅ |
| `error_message` | 错误提示的友好程度 | ✅ |

### 4.3 Skill Hub 模块

```typescript
// packages/skill-hub/src/index.ts
class SkillHub {
  private skills: Map<string, Skill> = new Map();
  private manifest: SkillManifest;

  // 加载所有 Skills
  async loadAll(): Promise<void> {
    // 1. 加载内置 Skills
    await this.loadBuiltInSkills();

    // 2. 加载用户 Skills
    await this.loadUserSkills();

    // 3. 加载社区 Skills
    await this.loadCommunitySkills();

    // 4. 根据 manifest 过滤启用的 Skills
    this.applyManifest();
  }

  // 获取启用的 Skills
  getEnabledSkills(): Skill[] {
    return Array.from(this.skills.values())
      .filter(s => s.metadata.enabled);
  }

  // 注册 Skill 到 Pi Agent
  registerToPiAgent(pi: ExtensionAPI): void {
    for (const skill of this.getEnabledSkills()) {
      if (skill.type === 'tool' || skill.type === 'hybrid') {
        pi.registerTool(this.createToolFromSkill(skill));
      }
    }
  }

  // 更新 Skill（用户编辑后）
  async updateSkill(id: string, updates: Partial<Skill>): Promise<void> {
    const skill = this.skills.get(id);
    if (!skill) throw new Error('SKILL_NOT_FOUND');

    Object.assign(skill, updates);
    await this.persistSkill(skill);
    this.rebuildManifest();
  }

  // 安装社区 Skill
  async installSkill(source: string): Promise<void> {
    // 从 URL 或本地文件加载
    const skill = await this.loadSkillSource(source);
    await this.persistSkill(skill);
    this.skills.set(skill.id, skill);
  }
}
```

### 4.4 Jotai Atoms

```typescript
// Session 隔离
const sessionAtomFamily = atomFamily((sessionId: string) => {
  return atom({
    messages: [],
    status: 'idle' as const,
    tools: [] as Tool[],
  });
});

// 全局状态
const watchlistAtom = atom<WatchlistItem[]>([]);
const alertsAtom = atom<Alert[]>([]);
const portfolioAtom = atom<Portfolio | null>(null);
const longbridgeStatusAtom = atom<'connected' | 'disconnected' | 'error'>('disconnected');

// Skill Hub 状态
const skillsAtom = atom<Skill[]>([]);
const activeSkillsAtom = atom<Skill[]>([]);  // 当前启用的 Skills
const skillEditorAtom = atom<{ skill: Skill | null; isEditing: boolean }>({
  skill: null,
  isEditing: false,
});
```

---

## 5. UI 设计

### 5.1 布局结构

```
┌─────────────────────────────────────────────────────────────┐
│  TopBar: [Logo] [搜索框] [市场状态] [告警图标] [设置]          │
├────────────┬──────────────────────────────┬───────────────────┤
│            │                              │                   │
│  LeftPanel │      MainContentPanel       │   RightPanel      │
│  ───────── │      ────────────────       │   ───────────    │
│  自选股     │      AI 对话区域            │   当前股票卡片   │
│  组合      │      + 工具输出渲染          │   迷你K线图     │
│  告警列表   │                              │   关键数据      │
│  Skills   │                              │                   │
│            │                              │                   │
├────────────┴──────────────────────────────┴───────────────────┤
│  InputBar: [模型选择] [输入框] [发送按钮]                      │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 组件列表

| 组件 | 说明 |
|------|------|
| `AppShell` | 主布局容器，PanelGroup |
| `TopBar` | 顶部导航栏 |
| `LeftSidebar` | 左侧边栏 (可折叠) |
| `MainContentPanel` | 主内容区，消息列表 |
| `RightPanel` | 右侧股票详情卡片 |
| `InputBar` | 底部输入框 |
| `SkillHubPanel` | Skill 管理面板 |
| `SkillEditor` | Skill 编辑器 |
| `SkillCard` | Skill 卡片（展示+开关） |
| `QuoteCard` | 股票报价卡片 |
| `KlineChart` | K线图组件 |
| `AlertList` | 告警列表 |
| `PortfolioSummary` | 组合概览 |
| `SetupWizard` | 首次安装引导 |

### 5.3 色彩系统

使用 Tailwind CSS v4 + OKLCH 色彩：

```css
:root {
  --background: oklch(0.98 0.003 265);
  --foreground: oklch(0.185 0.01 270);
  --accent: oklch(0.62 0.13 293);      /* 品牌紫 */
  --success: oklch(0.55 0.17 145);    /* 涨 (绿) */
  --destructive: oklch(0.58 0.24 28); /* 跌 (红) */
  --info: oklch(0.75 0.16 70);        /* 警告 (黄) */
}
```

---

## 6. 非功能性需求

### 6.1 性能要求

| 指标 | 目标 |
|------|------|
| 启动时间 | < 3 秒 |
| 报价查询响应 | < 2 秒 |
| 内存占用 | < 300MB |
| Skill 加载时间 | < 500ms |

### 6.2 安全要求

| 要求 | 实现方式 |
|------|----------|
| Token 存储 | Keychain (macOS) / Credential Manager (Windows) |
| Token 生命周期 | 启动时验证，过期引导重新登录 |
| Shell 安全 | 使用 execa 数组参数，禁止 shell 字符串拼接 |
| 参数校验 | 工具调用前白名单校验参数 |
| Skill 隔离 | 用户自定义 Skill 不可访问敏感 API |
| Skill 验证 | 加载前验证 JSON schema |
| 日志安全 | 不输出敏感信息 |
| CSP | 配置 Content-Security-Policy |

### 6.3 Skill 安全

| 风险 | 防护措施 |
|------|----------|
| 恶意 Skill | 仅允许安装来自白名单的 Skills |
| Prompt 注入 | 用户输入经过转义后再传入 prompt |
| 敏感数据泄露 | Skill 禁止访问 Keychain/Credential Store |
| 无限循环 | Skill 执行设置超时限制 |

### 6.4 告警引擎设计

| 场景 | 实现方式 |
|------|----------|
| 应用运行中 | AlertEngine 定时轮询（间隔 60s） |
| 应用最小化 | 通过 System Tray 后台运行 |
| 应用重启 | 从 JSON 文件恢复告警状态 |
| 告警触发 | 系统通知 API |
| 告警过期 | 触发后自动删除，或保留 24 小时历史 |

### 6.5 兼容性

| 平台 | 要求 |
|------|------|
| macOS | >= 12 (Intel + Apple Silicon) |
| Windows | >= 10 (x64) |
| Linux | Ubuntu 20.04+ (AppImage) |

---

## 7. 里程碑规划

### Phase 1: 核心框架 (MVP)
- [ ] Electron 基础项目搭建（含安全配置）
- [ ] Pi Agent 集成
- [ ] LongBridge 工具封装（安全参数化）
- [ ] 基础 UI 布局
- [ ] Setup Wizard 安装引导

### Phase 2: Skill Hub 基础
- [ ] Skill 数据结构和存储
- [ ] 内置 Tool Skills 注册
- [ ] Skill Hub UI（工具列表）
- [ ] Skill 启用/禁用

### Phase 3: Skill 自定义
- [ ] Prompt Skill 定义
- [ ] Skill 编辑器 UI
- [ ] 实时预览
- [ ] 预设风格

### Phase 4: 行情功能
- [ ] 实时报价查询
- [ ] K线/分钟线展示
- [ ] 财务数据查询

### Phase 5: 组合管理
- [ ] 持仓展示
- [ ] 盈亏分析
- [ ] 账户资产

### Phase 6: 告警系统
- [ ] 价格告警
- [ ] 系统通知
- [ ] 告警持久化
- [ ] 后台运行 (System Tray)

### Phase 7: Skill 生态
- [ ] Skill 市场 UI
- [ ] 社区 Skill 导入/导出
- [ ] Skill 版本管理
- [ ] Skill Hub API（供第三方扩展）

---

## 8. 验收标准

### 8.1 功能验收

| 功能 | 正常场景 | 异常场景 |
|------|----------|----------|
| **报价查询** | 输入股票代码，2秒内返回价格、涨跌幅、成交量 | 网络断开显示错误提示；代码不存在显示友好提示 |
| **Skill 启用** | 点击开关，Skill 立即生效 | 加载失败显示错误 |
| **Skill 编辑** | 修改 Prompt，保存后下次对话生效 | 格式错误显示验证提示 |
| **K线展示** | 支持日/周/月周期切换；支持缩放 | 数据加载显示骨架屏 |
| **组合查询** | 展示持仓列表、盈亏金额、收益率 | token 过期引导重新登录；空持仓显示引导提示 |
| **告警设置** | 设置成功后出现在告警列表；触发时发送通知 | 重复告警提示；未安装 CLI 时显示引导 |
| **新闻聚合** | 返回新闻标题、摘要、发布时间 | 无新闻显示提示；网络异常显示错误 |

### 8.2 技术验收

| 条件 | 验证方式 |
|------|----------|
| LongBridge 用户自安装 | 未安装时显示 Setup Wizard |
| Shell 安全 | 工具调用使用数组参数，无字符串拼接 |
| 跨 Session 隔离 | 同时多个会话不互相影响 |
| Skill 热加载 | 新增 Skill 无需重启应用 |
| Skill 自定义生效 | 编辑 Prompt 后下次对话生效 |
| 告警后台运行 | 最小化后 System Tray 显示，点击可恢复 |
| 打包分发 | electron-builder 生成可执行文件 |

### 8.3 边界场景

| 场景 | 预期行为 |
|------|----------|
| LongBridge CLI 未安装 | 显示 Setup Wizard，引导安装 |
| LongBridge token 过期 | 顶部 Banner 提示，点击重新认证 |
| 网络断开 | 显示网络不可用提示，提供重试按钮 |
| 查询不存在的股票 | 显示"未找到股票 XXX" |
| 设置重复告警 | 提示"该告警已存在" |
| 应用崩溃重启 | 从 JSON 文件恢复告警状态 |
| Skill JSON 格式错误 | 显示验证错误，阻止加载 |
| Skill 执行超时 | 显示超时错误，中断执行 |

---

## 9. 附录

### 9.1 LongBridge CLI 命令速查

```bash
# 行情
longbridge quote SYMBOL --format json
longbridge kline SYMBOL --period 1d --json

# 组合
longbridge portfolio --format json
longbridge positions --format json
longbridge assets --format json

# 财务
longbridge calc-index SYMBOL --json
longbridge institution-rating SYMBOL --json

# 告警
longbridge alert --list
longbridge alert --add --symbol SYMBOL --price 250

# 新闻
longbridge news SYMBOL --json
```

### 9.2 项目目录结构

```
finagent/
├── apps/
│   └── electron/                # Electron 主应用
├── packages/
│   ├── core/                   # 类型定义
│   ├── shared/                 # 共享逻辑
│   ├── ui/                     # UI 组件库
│   ├── pi-extension/            # Pi Agent 扩展
│   ├── longbridge-tools/        # LongBridge 工具封装
│   └── skill-hub/              # Skill Hub 系统 ⭐
│       ├── src/
│       │   ├── index.ts        # SkillHub 主类
│       │   ├── loader.ts        # Skill 加载器
│       │   ├── registry.ts      # Skill 注册器
│       │   ├── validator.ts     # Skill 验证
│       │   └── storage.ts      # Skill 持久化
│       └── skills/              # 内置 Skills
│           ├── get-quote/SKILL.json
│           └── market-summary/SKILL.json
└── package.json
```

### 9.3 Skill JSON Schema

```json
{
  "$schema": "https://finagent.app/skill-schema.json",
  "id": "market-summary",
  "name": "市场概览",
  "type": "prompt",
  "trigger": {
    "keywords": ["市场", "概览", "大盘"]
  },
  "prompt": {
    "system": "你是一个专业的金融市场分析师..."
  },
  "metadata": {
    "description": "生成市场概览摘要",
    "author": "finagent",
    "version": "1.0.0",
    "tags": ["market", "summary"],
    "enabled": true
  }
}
```

### 9.4 双审查员审查摘要

**v0.2.0 修复内容**：
- 🔴 Shell 注入风险 → 已改用 execa 数组参数
- 🔴 Token 生命周期管理缺失 → 已补充启动验证和过期引导
- 🔴 告警引擎机制不明确 → 已补充后台运行设计
- 🟡 参数白名单校验 → 已补充 validateSymbol 函数
- 🟡 错误处理链路不完整 → 已补充超时和 stderr 处理

**产品审查员建议**：
- 补充 AI 差异化价值说明 ✅
- 优先级调整：分析师评级/目标价降为 P2 ✅
- 验收标准量化：补充具体时间和错误场景 ✅
- 边界场景补充：6 种边界情况 ✅

**v0.3.0 新增内容**：
- 新增 Skill Hub 架构
- 支持 Tool/Prompt/Hybrid 三种 Skill 类型
- 前端 Skill Hub UI 支持编辑和自定义
- 内置 Skills 可被用户覆盖

**v0.5.0 新增内容**：
- 完善 Skill Hub 系统设计
- 前端 Skill Hub UI 入口：左侧边栏 "Skills" 标签
- Tab 功能：工具/提示词/商店/已安装
- 所有 Prompt Skills 支持前端实时编辑
- 内置 5 个 Prompt Skills：market_summary, stock_explain, alert_notification, error_message, price_alert_trigger
- 用户可启用/禁用任意 Tool Skills
- 支持从社区安装新的 Skills

---

*文档版本：v0.5.0*  
*创建日期：2026-05-05*  
*审查：风险审查员 + 产品审查员*
