# 统一证据契约（Source → Evidence ↔ Claim）

对应 Issue #100。Folio 此前并行演化了多套证据抽象：Copilot 的结构化金融事实
（`FinancialEvidenceEnvelope`）、Deep Research 报告的论点引用（`EvidenceRef`）、
网页/新闻（`NewsItem`）。核心风险不是功能缺失，而是**语义碎片化**——同一事实或
来源因来自不同子系统而获得不同的身份与元数据。本契约把它们统一到一条
**Source → Evidence ↔ Claim → Answer/Report** 关系链上。

## 设计原则

- **契约整合，不是新证据框架**。现有类型仍是各自生产方的权威表示，本契约是
  附加的、可投影的统一视图；不删除领域专属字段，不要求一次迁移。
- **增量演化**。现有持久化记录保持可读；投影函数只读输入、从不修改，
  不做大规模重命名迁移。
- **身份确定性**。所有 ID 由 sha256 确定性派生（截断 24 位，风格与
  `financial-evidence` 的 `fe_` 一致），不引入随机性，保证
  「组装 → 持久化 → 重新加载」全程稳定。

## 关系模型

```
EvidenceSource ──< EvidenceItem >── EvidenceClaim ──> Answer / ResearchReport
   （来源）            （证据）              （论点）
```

- 一个来源可产出多条证据；一条证据必须属于恰好一个来源。
- 论点与证据是**多对多**：一个论点可引用多条证据，一条证据可支撑多个论点。
  实现上由 Claim 单向持有 `evidenceIds[]`，Evidence 不反向命名 Claim。

## 代码位置

| 层 | 文件 | 内容 |
|----|------|------|
| core | `packages/core/src/evidence-contract.ts` | 契约类型与 schema 版本 |
| shared | `packages/shared/src/evidence/contract.ts` | 投影函数 + bundle 组装 + 序列化 |
| docs | 本文件 | 身份与生命周期语义 |

## 身份语义

| ID | 派生输入 | 语义后果 |
|----|----------|----------|
| `sourceId` | kind + origin（publisher / canonicalUrl / query） | 同一文档或同一查询被再次观察仍是**同一来源**；不含检索时间 |
| `evidenceId` | sourceId + kind + 内容 + retrievedAt | 同一事实**稍后再次观察**是同源新证据（observation），保留各自 provenance |
| `claimId` | statement + instrumentId 作用域 | 不同 run 产出**相同表述的论点**共享一个 claimId，在 bundle 中合并并并集其 evidence |

哈希输入统一经 `stableJson`（键排序）序列化，身份永不依赖对象键序。

## 投影函数

| 函数 | 输入（现有类型） | 输出 |
|------|------------------|------|
| `projectFinancialEvidence` | `FinancialEvidenceEnvelope[]` | 每个信封 → 1 个 `structured_finance` 来源 + 每个 value 一条 `structured_value` 证据（保留 metric/unit/currency/period/asOf/originalValue 金融语义） |
| `projectEvidenceRefs` | `EvidenceRef[]` | 每条引用 → 1 个 `tool` 来源 + 1 条 `tool_result` 证据 + 1 条 `unverified` 论点 |
| `projectNewsItems` | `NewsItem[]` | 每条新闻 → 1 个 `news` 来源（canonicalUrl=原文 URL）+ 1 条 `text_excerpt` 证据 |
| `projectTextEvidence` | 通用文档输入 | 1 个 `filing`/`web`/`news`/`other` 来源 + 1 条 `text_excerpt` 证据（保留 excerpt/location，支持 authority 元数据） |

组装与守卫：`buildEvidenceBundle`（按 id 去重合并、claim 并集 evidenceIds）、
`isEvidenceBundle`、`serializeEvidenceBundle` / `parseEvidenceBundle`（往返稳定，
未知 schema 版本返回 undefined）。

## 明确约定

- **结构化金融数据不伪造 URL**。`structured_finance` 来源没有公开文档，
  `canonicalUrl` 恒为空；其身份由 publisher + dataset + query 承担。
  缺 URL 是有语义的，不是缺失。
- **authority 元数据只在实际已知时填写**（如监管备案 =
  `{ primary: true, sourceClass: 'regulator' }`），投影从不猜测。
- **冲突与不可用是显式状态**（`availability: 'conflicted' | 'unavailable'`），
  不允许静默丢弃。
- **验证状态**首版恒为 `unverified`；claim 级验证（#13）与来源漂移检测（#20）
  是独立关注点，接入时只需更新 `verification` / `verifiedBy`，契约不变。
- 不为此引入图数据库；不要求各来源类型字段完全一致，领域专属元数据放在
  `providerMeta` / `provenance` 嵌套扩展中原样保留。

## 消费方

- **Source Inspector（#30）与引用检查器**可直接消费 bundle 投影：来源类别、
  URL、摘录、溯源一应俱全，无需再各自解析三套原始类型。
- **评测（#14/#15）**可基于 claimId/evidenceId 统计引用覆盖率。

## 集成示例

`packages/shared/src/evidence/contract.test.ts` 的
`mixed-source integration` 用例演示了同一 bundle 同时携带结构化金融证据、
tool 论点证据、新闻摘录与监管备案摘录，并验证序列化重载后完全一致。
