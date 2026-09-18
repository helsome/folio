# 隐私：脱敏与 Telemetry 内容策略

Folio 本地优先：会话、凭证与研究状态默认保存在设备上。本文档定义当数据**确实**要离开核心运行时——内核日志、诊断包、LangSmith/Langfuse telemetry、评测产物、IPC 错误负载、报告导出——时的处理规则。

所有规则只有一个来源：`packages/shared/src/privacy/`（issue #19）。新的数据出口必须从 `@finagent/shared/privacy` 导入，而不是各自维护正则列表。

## 统一规则源

| 模块 | 职责 |
| --- | --- |
| `privacy/redact-text.ts` | `redactText(text)` —— 字符串级 secret 模式匹配（fail-closed） |
| `privacy/deep-redact.ts` | `deepRedact(value)` —— 基于敏感字段名的深层遍历，带环/深度保护；`redactError(err)` —— 消息 + 堆栈序列化 |
| `privacy/policy.ts` | 字段名规则、账户类键形、`REDACTION_POLICY`、telemetry 内容策略 |

旧入口（`diagnostics/redact`、`evaluation/redactor`、`export/privacy`、主进程 `redactSecrets`）均委托到该模块，因此所有出口使用同一套规则。

## 始终脱敏的内容

无论隐私级别如何，以下内容绝不出现在日志、trace、诊断或评测产物中：

- 供应商 API key（`sk-…`、`sk-ant-…`、`rk-/pk-/ak-…`、Google `AIza…`、Slack `xox…`、SendGrid `SG.…`、GitLab `glpat-…`、npm `npm_…`、LangSmith `lsv2_…`）
- AWS 访问密钥（`AKIA…`）及 key/value 上下文中的 secret access key
- `Authorization` 头（Bearer 与 Basic）、`x-api-key` / `apiKey` / `api_key` 字段
- JWT 与版本控制系统 token（`gh*…`、`github_pat_…`）
- Cookie 与 session token（`Cookie`、`Set-Cookie`、`session_token`）
- 连接串中的凭证（`postgres://user:pass@…`、`redis://:pass@…`、`mongodb+srv://…`）——保留协议与主机，去掉凭证
- Webhook secret 与签名（`whsec_…`、`x-hub-signature…`）
- 私钥 PEM 块
- URL query 与 fragment 中的 secret（`?apikey=…`、`#token=…`）
- 较长的 base64 块（≥40 字符且含大小写）

脱敏是 **fail-closed** 的：遍历遇到循环引用、过深嵌套或内部错误时，该节点直接替换为 `[REDACTED]`——绝不会以原始负载作为回退输出。脱敏具有幂等性，且保留可观测性字段（run id、trace id、工具名、状态、耗时、时间戳）。

## Telemetry 内容策略（数据最小化）

内容最小化叠加在 secret 脱敏之上，通过评测设置的隐私级别（`evaluation.privacyLevel`，持久化在 evaluation store）选择：

| 级别 | 记录内容 | 适用场景 |
| --- | --- | --- |
| `minimal` | 仅名称、状态、耗时、计数——不记录 prompt、回答、工具参数/结果 | 最保守的配置；仍足以支撑时延/状态面板 |
| `standard`（默认） | 脱敏后的 prompt/回答/工具参数；组合类工具结果降级为 schema 摘要（形状 + 计数，绝不含持仓/现金/账户 id） | 所有用户的默认值 |
| `full` | 完整 trace 内容，仍然脱敏凭证 | 调试特定 run——仅显式 opt-in |

Pi agent 运行时从 `FINAGENT_PRIVACY_LEVEL` 环境变量（`minimal|standard|full`）读取同一级别；未知或未设置时工具输出在本地保留原始 DATA 块（未开启 tracing 时本就不会上传任何内容）。

**完整内容 tracing 绝不是默认值。** 调试需要时，在设置中将评测隐私级别改为 `full`（或在启动前 `export FINAGENT_PRIVACY_LEVEL=full`），调试完成后改回。

## 应用这些规则的出口

- **内核/主进程日志** —— `console.error` 处经由 `redactError` 序列化；主进程错误环形缓冲（`ErrorLog`）在采集时即脱敏消息与堆栈，堆栈首行不会回显原始错误文本。
- **诊断支持包** —— `serializeSupportBundle` 对每个字符串重新应用 `redactText` 并标记 `redaction.applied`。
- **评测产物**（`store.json`、run 记录、judge 结果）—— 回答/工具调用按隐私级别经 `EvaluationRedactor` 处理；run 与 judge 的错误消息在落盘前脱敏。
- **IPC 错误负载** —— `toIpcError` 在跨进程序列化前脱敏消息。
- **报告导出/分享** —— `redactForShare` 额外剔除账户类数值字段；正文与证据原样通过。
- **凭证存储** —— 所有错误路径经统一引擎脱敏；存储本身只向渲染进程返回元数据。
