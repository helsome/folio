# 历史研究报告选择与来源绑定测试报告（#327）

日期：2026-10-19。基线：`main` / `038f20cf2d87e3575ffbe5469967bdf6ef960dc8`。

## 行为与范围

Today、历史列表、论点保存和 What Changed 均以当前报告 ID 为对象。研究选择持久化为 `{symbol, reportId}`；切换证券同步使旧报告不可见，旧请求不能改回当前选择。历史入口在已有报告及研究运行期间均可用，显示完整生成日期与所选标记。不存在所选报告时明确报错，不回退至最新报告；没有对应比较时明确展示不可用状态。

保存沿原有 renderer/client → preload → IPC → kernel → converter → repository 路径传递报告 ID。`InvestmentThesis.sourceReportId` 为可选字段，兼容旧论点；转换及 schema 校验保留来源。diff 使用所选报告及其直接前序报告，验证缓存的证券和两端 ID；按需计算的历史 diff 不替换最新证券缓存。

本变更不扩展 #331 的全局工作台，也不修改 #326 的手动论点复审。开发由 Codex 辅助。

## 环境

- macOS 13.0.1（22A400），Apple Silicon arm64。
- Bun 1.4.2（与仓库 PR CI 固定版本一致）。
- Node 22.23.3，Electron 39.8.9，playwright-core 1.62.1。
- 独立仓库副本；依赖按现有 `bun.lock` 执行 `bun install --frozen-lockfile`，锁文件未修改。

## 实际执行命令与结果

```text
bun test packages/ui/src/components/research/ResearchPanel.test.tsx packages/ui/src/components/research/ResearchReportView.test.tsx apps/electron/src/main/research-selection.test.ts packages/shared/src/thesis/converter.test.ts --isolate
→ 40 pass / 0 fail，4 files，112 assertions

bun test --isolate
→ 2011 pass / 7 skip / 0 fail，217 files，8660 assertions

bun run typecheck
→ core / i18n / shared / ui / electron 全部 exit 0

bun run i18n:check
→ en-US / zh-CN 各 1509 keys，0 issues

bun run build
→ packages、renderer、preload、main 构建成功

node apps/electron/e2e/research-selection.mjs
→ 6 个实际 Electron 交互场景通过；blockedNetwork=0，blockedCommands=0

node --check apps/electron/e2e/research-selection.mjs
git diff --check
→ 通过
```

构建仍提示现有 renderer chunk 超过 500 kB；未为此扩大重构范围。

### 分层回归

- 组件：A 两份、B 一份；Today 旧版内容和原始日期；已有报告和运行中可达的历史；切证券时同步清理；迟到报告、历史列表、diff、保存回执、轮询和恢复回执；同证券快速换版；显式缺失报告；Start/Resume/Restart 请求期间的版本选择及 loading 收尾。
- 主进程集成：调用真实 kernel 方法及真实 ResearchService、diff 构建、converter、文件仓库；旧版保存及重新打开后的 `sourceReportId`；拒绝不存在、跨证券和格式错误的显式 ID；最新缓存与历史前序的边界。没有构造完整 kernel，以避免启动无关 provider；完整 IPC 路径另由桌面测试验证。
- 实际桌面：由 Playwright 启动真实 Electron，加载正式构建的 renderer 和 preload，使用全新 userData。手工生成的 A/B 报告明确标记为 fixture；研究报告读取、diff、论点转换和落盘均使用真实主进程实现。

先在未修复实现观察到 15 项核心行为失败，再修正；独立复审发现的 Start/恢复竞态也分别观察到失败后修复。复审最后确认 7 项专项回归通过，当前授权范围无遗留发现。

## 桌面截图与重启证据

执行桌面命令后，忽略目录 `apps/electron/e2e/artifacts/research-selection/` 包含：

| 文件 | 实际验证内容 |
| --- | --- |
| `today.png` | A 两份、B 一份的 Today 入口 |
| `today-old-report.png` | 点击 A 旧版，结论为 `a-old`，日期为 2026-10-17；明确无可用 diff |
| `history.png` | 始终可达的历史、完整日期和所选标记 |
| `selected-diff.png` | A 新版的 What Changed；IPC 核验前序为 A 旧版 |
| `old-thesis-saved.png` | 旧版保存成功；测试另读取真实论点 JSON 核验来源 |
| `security-b.png` | 切到 B 后只有其报告与一条历史 |
| `start-pending-existing-history.png` | 真实 fill/Enter 输入 B，启动 pending 时不会自动打开旧版 |
| `start-failure-existing-history.png` | 受控启动失败后的提示与正确证券 |
| `restart-old-report.png` | 关闭并重新启动 Electron 后仍打开 A 旧版 |
| `verification.json` | 6 项结果、IPC 请求 ID 与离线边界计数 |

同一脚本还在原样基线的独立构建运行，Today 点击 A 旧版后等待旧版结论失败，截图显示的是 `a-new` 与 2026-10-18。Before/After 为真实组件截图，没有绘制或替换界面。截图、profile、构建产物及原始日志不加入源码提交；截图供 PR 附件与本地核对使用。

## 基线、环境限制与跳过

- 当前 main 已引入 Yahoo provider，但 `kernelHost.test.ts` 的 shared mock 缺少对应导出。原样基线复现该文件加载失败；本 PR 补一行测试 mock 后原 17 项通过，未修改 provider 行为。
- 沙箱默认不允许 Langfuse 单测绑定回环 mock HTTP 服务，初次全仓出现 3 项端口失败。仅允许该本地测试权限后，Langfuse 13 项及最终完整套件通过；没有连接真实 Langfuse。
- 7 项跳过均依赖未提交的私有 Longbridge 账户 fixtures（positions、assets、cash-flow、portfolio 解析或 argv 校验）。未复制真实账户数据或为补齐测试进行交易服务认证。
- Electron 需桌面进程和本地调试端口权限。初版 fixture 也曾被 onboarding 主进程标记阻挡，并拦截到 Today buildBrief 的 3 次 Longbridge 子进程尝试；均未实际执行外部命令。补齐隔离初始化及 buildBrief 通道后，最终 6 场景的网络/外部命令尝试均为 0。
- fixture bootstrap 在导入应用前拒绝网络及外部命令，拦截市场、连接、模型、研究启动/恢复和复审等无关通道，并关闭隔离 profile 的自动化。唯一启动交互返回受控失败，不运行模型。
- 这些结果证明报告身份、实际桌面导航及本地持久化，不代表真实 provider、付费模型或线上交易验收。未调用付费模型、交易服务、部署或修改真实业务数据。

## 与既有 PR 的关系

已只读对比 #337 和 #345；两者均未合入本次基线。#337 覆盖主要 reportId 传递，但无回归测试，仍有异步失效与调用签名缺口。#345 同时涉及 #331/#326，本 PR 保留 #327 边界，并补充持久选择、精确缓存校验、来源 ID 落盘及实际桌面证据。没有修改其他贡献者 PR 或联系维护者。
