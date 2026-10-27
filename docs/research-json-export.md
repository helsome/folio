# 研究报告 JSON 归档导出

Refs #36。本次修改提供独立的 JSON 归档导出能力。

在已有研究报告的「导出」菜单选择「下载归档 .json」，文件名为
`<symbol>-research.json`。主进程根据 `reportId` 读取持久化报告；预加载层只传递
报告身份，归档使用 `application/json` 下载。

## 归档契约

- `schemaVersion`：`folio-research-archive/v1`。
- `report`：当前公开 `ResearchReport` 字段，包括报告身份、标的、生成时间、策略、
  语言、分析章节、判断、引用及能力运行结果；保留 `partial` 和 `unavailable` 状态。
- `evidence`：复用 `buildReportEvidenceBundle` 的来源、证据和主张关联，以及该契约
  已有的验证状态。引用中的运行身份来自报告中的能力运行记录。

导出先选择公开字段，再复用 `redactForShare` 和诊断导出的字符串脱敏规则。
附加的运行配置和凭据字段不进入归档。字符串脱敏在 JSON 编码前执行，保留合法
JSON 和现有引用结构。归档结果是可分享的投影，不作为凭据或完整用户数据备份。

本次范围保留当前报告已经存储的信息。HTML/打印输出、完整运行清单，以及当前
报告契约没有保存的原始 Web/金融来源元数据，仍属于 #36 的其余范围。

## 可复现验证

环境：Windows 10 x64，版本 `10.0.19045`；Bun `1.4.4`；Node `24.22.1`；
锁定依赖中的 Electron `39.8.9`。基线为
`f5822f0cb27b1f5843fe3ed5cc2f3f5baecc75de`。

输入使用仓库公开保存的真实 DeepSeek / Longbridge 验收报告：
[final-report.json](acceptance/research-recovery/final-report.json)。原始调用及恢复过程
见 [研究恢复验收报告](research-recovery-test-report.md)。该报告包含真实新闻能力的
结果，并明确记录其余能力不可用。本次验证重放这个真实记录，没有重新调用模型、
金融 API 或 Web 服务。

以下命令从仓库根目录执行：

```text
bun test --isolate packages/shared/src/export packages/shared/src/diagnostics/redact.test.ts packages/shared/src/research/repository.test.ts packages/shared/src/research/repository.report-id.test.ts packages/ui/src/components/research/ExportMenu.test.tsx
61 pass / 0 fail，200 次断言，8 个文件

bun test apps/electron/src/main/kernelHost.test.ts --isolate
25 pass / 0 fail，57 次断言

bun test packages/shared packages/ui packages/i18n apps/electron --isolate
1996 pass / 1 fail，8482 次断言，206 个文件

bun run typecheck
core / i18n / shared / ui / electron 全部 exit 0

bun scripts/i18n-check.ts
en-US / zh-CN 各 1558 个键，0 个问题
```

工作区测试唯一失败为 `pi-rpc-restart.test.ts` 中真实子进程重启测试的 5000 毫秒
超时。在独立、未修改的上述基线副本运行同一文件，结果为 `9 pass / 1 fail`，
相同测试超时。该失败未标记为通过。

归档专用测试使用真实 `JsonFileStore` 和 `ResearchReportRepository` 写入、重新
打开并导出实际报告，验证报告内容、证据关联、输入不被修改以及重载前后的字节
一致性。新增归档测试没有替换存储或 IPC。

构建命令从 `apps/electron` 执行：

```text
bun run build:preload
bun run build:main
bun x --no-install vite build
全部 exit 0
```

## Electron 验收状态

已提供实际应用验收脚本，从仓库根目录执行：

```text
node apps/electron/e2e/research-export.mjs
```

脚本为公开报告建立独立用户目录，通过实际 preload / IPC 读取报告，检查缺失
报告和非法身份，再操作菜单下载并重新加载。输出保存在被忽略的
`apps/electron/e2e/artifacts/research-export-*`。

本机执行停在 Electron 启动阶段，未进入脚本中的功能断言。相同 Electron 二进制
单独执行 `--version` 也以 `2147483651`（`0x80000003`）退出；其 Node 模式能够
运行。当前原因仍需进一步确认。此次没有完成 Electron 菜单下载验收，也没有
取得实际产品截图；草稿 PR 保持此状态，完成验收后再进入正式审核。

本次只覆盖 JSON 子能力；#36 要求的完整金融/Web 来源及表格验收尚未完成。
