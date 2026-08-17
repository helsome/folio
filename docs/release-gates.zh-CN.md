> 本文是 [release-gates.md](release-gates.md) 的中文翻译；如有出入，以英文原文为准。

# Folio V4 — 发布门槛

发布流水线：`internal` → `beta` → `stable`。V4 交付首个 **Beta** 候选版本。
门槛由 `bun run release:check`（或 CI 步骤）在打标签前强制执行。任何一项门槛
未通过的构建均为 `NOT RELEASEABLE`（不可发布），必须标记为 internal/未签名构建
（规格 §38–40）。

## 硬性发布阻断项（任一项存在 → 不满足 Beta 就绪，规格 §64）

1. 投资组合损坏 / 数据乱码（解析器拿到错误的 CLI 输出结构、未规范化的数值、UI 中出现原始厂商输出）
2. 技能交互损坏（点击无反应、IPC 静默失败）
3. 引导流程无法完成（全新安装、无仓库、无 .env）
4. 提供商在断开/过期后无法重连
5. 日志、打包产物或诊断导出中包含密钥
6. 白屏（错误边界之外的未捕获渲染进程错误）
7. 打包资源缺失（技能、pi 扩展、渲染进程资源）
8. 提供商状态不准确（认证已失效却显示已连接）
9. 关键操作静默失败（无反馈、无错误）
10. `bun test`、`bun run typecheck` 或打包冒烟测试变红

## 测试金字塔（规格 §59–67）

测试分为四个层级；每个层级是下一层级的前置门槛。子代理、Lead 与发布流水线
各自只运行其角色所需的层级（见下方规则）。发布标签前所有层级必须全绿。

### 层级 1 — 单元测试（按包，在工作树内）

| 内容 | 命令 |
|---|---|
| 单个包内的单元/集成测试 | `bun test packages/<pkg>` |
| 单个包的类型检查 | `bunx tsc --noEmit`（cwd = 包目录） |

- 包被改动期间每次迭代都要运行。
- **子代理规则（规格 §65）：** 子代理只在自己改动的包内运行 `bun test packages/<pkg>`
  与 `bunx tsc --noEmit`。绝不运行仓库级门槛，绝不启动 Electron/Folio，不运行格式化器/lint。
- 仓库级变体：`bun run test:unit`。

### 层级 2 — 集成测试（仓库级，在工作树内）

| 内容 | 命令 |
|---|---|
| 仓库级单元/集成测试 | `bun run test:unit` |
| 仓库级类型检查 | `bun run typecheck` |
| UI 组件测试 | `bun run test:ui`（`bun test packages/ui`） |

- `bun run test:integration` = 测试 + 类型检查合二为一。
- **Lead/CI 规则（规格 §66）：** Lead 在合并后运行层级 2 + 层级 3；
  层级 2 以下单独出现都不能构成发布门槛。

### 层级 3 — 隐藏式 Electron E2E（真实应用，窗口不显示）

| 内容 | 命令 |
|---|---|
| 黄金路径 A–H | `FINAGENT_AGENT_PROVIDER=local bun run test:e2e` |
| 交互契约扫描 | `cd apps/electron && bun run test:interactions` |
| 技能交互 | `cd apps/electron && bun run test:skills-interactions` |
| 打包应用冒烟测试 | `bun run test:package-smoke` |
| 全新安装引导 | `cd apps/electron && bun run test:fresh-install` |

- 每个测试框架都以**隐藏**方式启动真实 Electron 应用：在 spawn 环境中设置
  `FINAGENT_E2E=1` 与 `FINAGENT_E2E_HIDDEN=1`。
- **隐藏模式是真实的，不是模拟（规格 §61）：** `FINAGENT_E2E_HIDDEN=1`
  只是在 BrowserWindow 上设置 `show: false`（见
  apps/electron/src/main/index.ts 中的 `createWindow`）。窗口仍然创建，
  渲染进程照常加载运行，`--remote-debugging-port` 持续将其暴露给 CDP——
  桌面屏幕上什么都不出现，但完整 DOM + IPC 接口面都可被驱动。
- 每个测试框架在启动前会自行清理自己的 CDP 端口（pkill 自己的
  `remote-debugging-port=NNNN`），中断的运行不会留下僵尸窗口。

### 层级 4 — 可见 / 发布（手动调试 + 发布门槛）

| 内容 | 命令 |
|---|---|
| 可见 E2E（手动调试） | `bun run test:e2e:visible` |
| 发布门槛套件 | `bun run test:release` → `bun run release:check` |

- `FINAGENT_E2E_VISIBLE=1` 仅用于手动调试时强制显示窗口；
  它优先于 `FINAGENT_E2E_HIDDEN=1`。自动化运行必须保持隐藏。
- **发布规则（规格 §67）：** 打标签前必须依次执行 `release:check` → 打包 →
  针对打包后的 Folio.app 运行 `test:package-smoke` + `test:fresh-install`。

### E2E 标志契约

| 标志 | 设置者 | 作用 |
|---|---|---|
| `FINAGENT_E2E=1` | 每个测试框架（spawn 环境） | 将进程标记为 E2E 测试框架运行。契约：主进程代码可据此区分测试运行与真实使用；目前它不产生任何行为影响——隐藏/可见由下面两个标志控制。 |
| `FINAGENT_E2E_HIDDEN=1` | 每个测试框架（spawn 环境） | BrowserWindow 以 `show: false` 创建——渲染进程 + CDP 完全可用，屏幕上不显示任何内容。所有自动化测试框架的默认值。 |
| `FINAGENT_E2E_VISIBLE=1` | 仅手动调试 | 即使设置了 `FINAGENT_E2E_HIDDEN=1` 也强制显示窗口（可见 = `VISIBLE==='1' \|\| HIDDEN!=='1'`）。自动化运行绝不设置。 |
| `FINAGENT_E2E_KEEP_OPEN=1` | 仅调试 | 测试框架结束时**不**杀掉应用；它打印 `KEEP_OPEN` 与 CDP 端口后让应用继续运行，便于你附加调试。**自动化运行或 CI 中绝不设置**（见下方警告）。 |

### KEEP_OPEN 警告（规格 §63）

`FINAGENT_E2E_KEEP_OPEN=1` 是调试逃生通道：测试框架跳过最后的关闭步骤，
打印 `KEEP_OPEN CDP port <port>` 后退出，让应用继续运行（隐藏窗口 + CDP 保持）。
自动化运行——CI、`release:check`、`test:e2e`、`test:e2e:visible`、
`test:package-smoke`、`test:fresh-install`——绝不能设置它：它们依赖测试框架
杀掉应用并在下次运行时复用其 CDP 端口。清理保持打开状态的实例：
`pkill -f 'remote-debugging-port=<port>'`。

## 质量门槛（反复运行，绝不只是最后跑一次，规格 §69）

| 门槛 | 命令 | 要求 |
|---|---|---|
| 单元/集成测试 | `bun run test:unit` | 0 失败 |
| 类型检查 | `bun run typecheck` | 干净 |
| 构建 | `bun run build` | 干净（渲染进程 + preload + 主进程 + 扩展） |
| Electron E2E | `FINAGENT_AGENT_PROVIDER=local bun run test:e2e` | 黄金路径 A–H 全绿 |
| 打包冒烟测试 | `bun run test:package-smoke` | 全绿（在仓库外运行） |
| 全新安装 E2E | 干净的 `userData`、无仓库，引导 → 工作台 → 行情 → 投资组合 → 技能 → 研究 → 论点 → 提醒 → 重启 | 全绿 |
| 交互审计 | Playwright 按钮契约套件 | 每个控件：有行为 或 已禁用 或 已移除 |
| 提供商冒烟测试 | 连接 Longbridge → 状态准确 → 经路由器的行情/K 线/新闻/投资组合 | 全绿 |
| 密钥扫描 | 产物或打包内容中无密钥/令牌 | 干净 |

## Beta 发布门槛（规格 §70 最终验收）

模拟一个真实的新用户——无 git 仓库、无 `.env`、无终端：

1. 安装 Beta → 欢迎页 → 接受隐私/免责声明（一次性）
2. 连接 AI（提供商 + 凭证 + 模型 + 测试）
3. 连接 Longbridge（应用内流程；无需 shell）
4. 连接测试通过；能力矩阵显示真实覆盖情况
5. 健康检查：AI ✓ 行情数据 ✓ 技能 ✓ Agent 运行时 ✓
6. 进入 Today → 打开 NVDA → 行情/图表渲染且带新鲜度信息
7. 深度研究 → 证据报告 → 保存论点
8. 投资组合渲染：数字、名称（unicode）、货币、盈亏——无 NaN/undefined/[object Object]
9. 技能：禁用 Technical → 状态立即变化 → 重新启用 → 状态立即变化 → 打开详情 → 所有控件可用
10. 退出 → 重新启动：连接、投资组合、技能、会话、研究、论点全部保留

## 发布通道 / 版本管理

- 根 `package.json` + `apps/electron/package.json` 中的 SemVer
- `apps/electron/package.json` 中的通道（`folia.channel`）：
  `internal` | `beta` | `stable`
- About 视图显示版本 + 构建（git SHA）+ 通道
- 标签：`vX.Y.Z-beta.N` → GitHub Release 资源（DMG + 校验和）

## 签名策略

- 无 Apple 凭证 → 未签名的 `internal` 构建，标记为 NOT RELEASEABLE
- `beta`/`stable` 通道要求 CI 中配置签名 + 公证（凭密钥保护）；缺少它们时
  流水线不得产出“release”。
