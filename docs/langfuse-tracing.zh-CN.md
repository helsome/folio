# Langfuse 追踪（Agent / 深度研究）

Folio 通过统一边界 `LangfuseEvaluationBackend` 把 Copilot 与深度研究运行导出到
Langfuse。业务代码不直接依赖 Langfuse 事件类型。Langfuse 关闭、未配置或不可达时，
Agent 主流程仍会完成，并留下可诊断日志。

## 配置

| 来源 | 字段 |
| --- | --- |
| 设置 → 评测 | Langfuse 追踪开关、主机、public key、secret key（Electron `safeStorage`） |
| 环境变量 | `LANGFUSE_TRACING`、`LANGFUSE_PUBLIC_KEY`、`LANGFUSE_SECRET_KEY`、`LANGFUSE_HOST` |

默认主机：`https://cloud.langfuse.com`。密钥不会进入仓库、日志或渲染进程。

即使已配置密钥，也可以用 `LANGFUSE_TRACING=false` 关闭导出。

## Trace / span 结构

一次 Folio run 对应 **一条** Langfuse trace，而不是单个 LLM span。

### Copilot（`folio.agent_run`）

- 根 trace：用户输入 + 最终回答、tags、metadata
- 每个工具一次 `tool.<name>` span
- 在可知模型 / token 用量时写入 `agent.generation`
- 失败时写入 `agent.error`

### 深度研究（`folio.deep_research`）

- 根 trace：标的 / 查询 + 报告摘要
- `research.input`
- 每个计划能力一次 `retrieval.<capabilityId>` span
- `research.synthesis` generation
- `research.report`（立场、置信度、证据数量）

## Metadata 与 tags

可过滤 tags：

- `folio`
- `run_kind:normal` / `run_kind:evaluation`
- `gold_case:<id>`
- `dataset:<id>@<version>`
- `model:<id>` / `provider:<id>` / `strategy:<id>` / `agent:<version>`

根 metadata 至少包含 `folioRunId` 与 `runKind`；评测运行还会带上 gold case /
dataset / model。

## Score schema

分数写回 **同一条** trace（`score-create`）：

| 名称 | 范围 | 含义 |
| --- | --- | --- |
| `groundedness` | 0..1 | 证据覆盖或 judge groundedness |
| `citation_coverage` | 0..1 | 带 evidence ref 的章节比例 |
| `task_completion` | 0..1 | 完成 / 部分完成 / 失败 |
| `tool_retrieval_success` | 0..1 | 成功的工具或能力比例 |
| `latency_ms` | 毫秒 | 墙钟耗时 |
| `human` | 数值 | 可选人工反馈 |

当 Langfuse 是当前评测后端时，`bun run eval:smoke` / `eval:full` 也会把
registry 里的 `task_completion` 与 `groundedness` 写回。

## 降级

- 缺少密钥 → `NoopEvaluationBackend`（kind `none`）
- HTTP 5xx / 超时 / 中止 → ingest 返回失败，运行继续
- 分数写回失败被吞掉
- 诊断：设置页测试连接、主进程错误日志、CLI `eval:langfuse`

## 命令

```sh
bun test packages/shared/src/evaluation/langfuse/langfuse.test.ts
bun run eval:langfuse
```

重新生成设置页截图：

```sh
bun scripts/eval/screenshot-langfuse-settings.ts
```
