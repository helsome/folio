# Issue #32 文档来源测试报告

状态：已完成来源与证据工具层验证；真实 Agent 研究会话及 Electron UI E2E 尚未完成。本文只记录实际执行或 CI 可核对的结果，不将工具层验证当作 Issue #32 的最终 E2E。

## 环境

- Windows NT 10.0.26200.0
- Bun 1.4.2 (744846f84)
- 基线 main commit: `6a9a288eb354c01ae39a0339c902dd38e94ee89c`

## 实际执行结果

```text
bun test packages/shared/src/research-documents
30 pass / 0 fail / 62 assertions

bun test packages/core packages/shared --isolate
899 pass / 1 fail / 3410 assertions

bun run typecheck
core / i18n / shared / ui / electron: all exit 0

git diff --check
exit 0

bun scripts/research-documents-live.ts
PASS: production registry -> generated tools -> real SEC / Apple documents -> evidence
```

Focused tests cover issuer validation, historical periods, amendments, partial failures,
cancellation, evidence offsets and hashes, real tool wiring, research EvidenceRef propagation,
redirect restrictions, request headers, access denial and response size limits.

## 当前 PR 提交的 CI 复核（2026-09-26）

本次 CI 验证的 PR #95 代码提交为 `7909d36404d6dc3aabdcc9f0839cafa881f276be`；后续文档更新不改变该提交的代码。
[GitHub Actions PR checks #112](https://github.com/helsome/folio/actions/runs/34682188426) 的结论为 success：

- Typecheck：success
- Focused tests：success
- Full unit tests (advisory)：success
- Secret scan：success
- Full unit tests（仅 main push 运行）：skipped，符合 workflow 条件

以上为 GitHub Actions 对该提交的检查结果。2026-09-26 在本地下载源码后未重新运行 Bun 测试：当前环境没有 Bun 和项目依赖；因此不把旧的本地结果描述为本次复跑。

## 已知失败及基线对照

`PiRuntimeAdapter > removes the session conversation file on disposeSession` fails at
`packages/shared/src/agent/pi-runtime-agent-backend.test.ts:621`: the Windows sandbox
denies creating `/tmp/pi` (resolved to `C:\tmp\pi`).

Running `bun test packages/shared/src/agent/pi-runtime-agent-backend.test.ts` in a clean
worktree at the base commit produces the same failure: 16 pass / 1 fail / 31 assertions.
The failing test and implementation are unchanged by this PR. This comparison is against
the recorded base commit, not a claim that the latest upstream main has been tested.

## 真实来源验证

Run at 2026-09-11T12:50:18Z with SEC contact information supplied through an environment
variable (not committed). No fixtures replace the provider responses.

- SEC: Apple 10-K, filed 2025-10-31, reporting period 2025-09-27,
  accession `0000320193-25-000079`; extracts `Net sales` evidence from the actual HTML.
- Apple: current official Newsroom feed and a linked official announcement; reporting
  period remains absent when not provided by the publisher.
- Both use the same issuer identity and return source types, document IDs, bounded
  evidence spans, SHA-256 content hashes and text-fragment source links.

The script prints a Markdown source report and is reproducible with the command above.
Feed contents and normalized offsets may change. This is provider/tool integration,
not an LLM-generated final investment answer or an Electron UI E2E result.

## 待完成验收

- 运行真实 Agent 研究会话：同一上市公司同时检索监管披露和另一种来源，并检查模型最终回答中的来源类型与 evidence 跳转。现有 `scripts/research-documents-live.ts` 仅生成确定性的来源报告，没有调用 LLM。
- 在 Electron 中检查实际研究结果和引用跳转。当前没有完成该 PR 的 UI E2E 或截图；PR 未修改 UI 组件，是否需要截图应按仓库 PR 模板及最终可见变化判断。
- Apple IR 连接器仅覆盖当前 Newsroom feed。PDF 文本定位及付费研报连接器未实现，属于已声明的范围限制。

因此，CI 通过和真实来源工具调用不能单独证明 Issue #32 最后一条验收标准完成；维护者可据此评审已实现的部分，最终 E2E 仍需补证。
