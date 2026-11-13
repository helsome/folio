# 金融研究文档来源（Issue #32）

`research.documents` / `search_research_documents` 和
`research.documentEvidence` / `get_document_evidence` 在 production full registry 注册，
因此 Electron main 和 Pi 生成的工具使用同一套 manifest。默认和 comprehensive 深度研究计划接入文档检索。

## 来源与覆盖范围

- SEC EDGAR：Submissions API 的 recent 列表；指定报告期或发布日期时，读取匹配的历史文件。
  单次最多 20 个历史文件，超出时返回明确错误，要求缩小日期范围，不静默截断历史。
  内置 AAPL/NVDA/TSLA/MSFT CIK；其他美国上市公司可提供 CIK，API 返回的 ticker 必须与 symbol 一致。
- Apple 官方 Newsroom Atom：首版 IR/公司公告连接器，仅覆盖当前 RSS 窗口。
  不把缺少报告期的公告冒充为指定财政年度的财报。每次返回覆盖范围和各来源状态。
- 第三方研报：独立 `ResearchReportAdapter` 契约明确 source type 和许可范围；未接入付费服务，
  不抓取付费全文，也不把研报观点提升为监管披露。

SEC 要求设置 `FINAGENT_SEC_USER_AGENT`（访问者名称和联系邮箱），仅传给 SEC 官方主机。
不要提交真实值。参见 [SEC API 文档](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
和 [SEC 访问要求](https://www.sec.gov/about/developer-resources)。未配置会报告具体错误，不生成假财报。

## 查询与证据

参数支持 symbol、CIK、subtype、periodEnd、publishedFrom、publishedTo、authority、limit。
subtype 为 `10-K` 时包括 `10-K/A`；精确查询 `10-K/A` 只返回修订。
周期报告按 issuer + base form + period 建立 version family，仅存在唯一原始报告时填入 amendment 关系。
8-K 不因同一天发布而武断地归为同一个文件。

可传 `evidenceQuery` 从至多两个来源各抽取一份 HTML 文档的证据，也可以直接调用 evidence 工具。
结果包含 document ID、SHA-256、规范化文本偏移、至多五段有界引用和 `#:~:text=` 跳转。
偏移不是 HTML 字节位置，不编造页码或 section。PDF 暂不支持；未命中不代表事实不存在。
现有 `EvidenceRef` 向后兼容地增加 document ID、source type、canonical URL、document evidence。
来源文本只是非可信证据，不能覆盖 Agent 指令。

HTTP 只允许 SEC 和 Apple 固定官方主机，每次重定向重新校验；限制超时、15 MB 响应大小、
SEC 请求速率。不会读取任意用户 URL 或绕过访问拒绝。服务不保存全文或主动写 telemetry；
调用方应遵守 licensing 中的 `telemetryAllowed: false`，不要导出引用正文到追踪平台。

## 可复现验证

```sh
bun test packages/shared/src/research-documents
bun test packages/shared/src/capabilities packages/shared/src/research packages/shared/src/strategies
bun run typecheck
# 在本地环境配置 SEC 联系信息后：
bun scripts/research-documents-live.ts
```

Live 脚本不使用 fixtures，经 production registry 和生成的 Agent 工具检索 Apple 真实 10-K 和官方公告，
定位财报内 `Net sales`，输出带来源类型与证据跳转的 Markdown 来源研究报告。
它不等同于 LLM 决策或 Electron UI E2E；这两个层面的测试应单独报告，不能以脚本成功替代。
