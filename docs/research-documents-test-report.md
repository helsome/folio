# Issue #32 文档来源测试报告

状态：Draft，完成来源和证据工具层验证，尚未完成 LLM / Electron UI 验收。

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

- Run an actual Agent research conversation and inspect final citations.
- Verify visible research output in Electron and attach screenshots before review.
  The local Electron executable is unavailable; no UI pass is claimed.
- Current IR connector covers Apple Newsroom only; PDF extraction and paid research
  connectors are outside this draft's implemented scope.

The full Issue #32 is not claimed complete by this draft.
