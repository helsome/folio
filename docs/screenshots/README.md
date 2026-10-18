# Folio screenshot inventory / 运行截图说明

The README gallery reuses real Electron application captures already published in this repository. No images were generated or altered for the README refresh.

README 图库复用仓库已公开的真实 Electron 应用截图。本次文档更新没有生成、重绘或修改图片。

## Provenance / 来源

- Capture commit / 截图提交: [`bc076da9a94d014076e02fd0a0dbcae3a3e01851`](https://github.com/helsome/folio/commit/bc076da9a94d014076e02fd0a0dbcae3a3e01851), 2026-08-28
- The commit records recapturing the nine screens with [`apps/electron/e2e/visual.mjs`](../../apps/electron/e2e/visual.mjs), the local agent provider, and demo data
- Review baseline / 本次文档核对基线: [`ba5dcdfd31b162f5edb8b908f7f099a560389326`](https://github.com/helsome/folio/commit/ba5dcdfd31b162f5edb8b908f7f099a560389326)
- These are historical UI captures, not a new end-to-end run, live market quotes, real account holdings, or evidence that every integration is connected
- 以下是历史界面截图，不是本次重新运行应用的结果，也不是实时行情、真实账户持仓或所有集成均可用的证明

## Gallery / 图库

| File | Size | What is visible / 可见状态 |
| --- | --- | --- |
| [today.png](today.png) | 1440 × 900 | Today overview; portfolio, watchlist, and events show Sample data / 今日概览，示例数据标记 |
| [portfolio.png](portfolio.png) | 1440 × 900 | Sample portfolio, allocation, holdings, research actions / 示例组合、配置与持仓 |
| [events.png](events.png) | 1440 × 900 | Sample calendar and research context; no generated catalyst summary / 示例日历，未伪造催化综述 |
| [workspace.png](workspace.png) | 1440 × 900 | Selected security with unavailable provider data and missing values / 标的已选，行情未接入，数据缺失 |
| [discover.png](discover.png) | 1280 × 800 | Screening task selection, not screening results / 筛选任务入口，并非已完成结果 |
| [skills.png](skills.png) | 1280 × 800 | Capability counts and readiness states / 能力覆盖与就绪状态 |
| [settings.png](settings.png) | 1280 × 800 | General preferences and unconfigured runtime state / 通用偏好与未配置运行时 |
| [evaluation.png](evaluation.png) | 1280 × 800 | Evaluation Center with no completed experiments / 尚无已完成实验的空态 |
| [profile.png](profile.png) | 1280 × 800 | Local workspace health with providers needing setup / 本地工作区健康检查，提供商待配置 |

The Longbridge setup banner, empty states, and `Sample data` badges are intentionally retained. Sample portfolio values and event dates are demonstration data and should not be used as investment inputs.

Longbridge 配置提示、空态与 `Sample data` 标记均按原样保留。示例组合数字和事件日期仅用于演示，不能作为投资依据。

## Refreshing captures / 更新截图

Use an isolated demo profile without personal credentials or account data. Inspect every image before committing it, preserve sample-data and unavailable-data labels, and record the capture commit, date, platform, and command. The current visual harness has a macOS-specific Electron binary path; check it before running on another platform.

请使用隔离的演示用户目录，不连接个人凭证或真实账户。提交前逐张检查，保留示例数据与数据缺失标记，并记录截图对应的提交、日期、平台和命令。当前 visual harness 使用 macOS 专用 Electron 路径，其他平台运行前需先核对。
