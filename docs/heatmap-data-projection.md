# 热力图数据投影（#333 子范围）

`buildHeatmapSnapshot` 是热力图的数据准备层，不是已接线的产品入口。
它接受列表已有的证券/行情/持仓快照，输出分组后的单元格；不发起网络请求、
不创建第二套行情缓存、不做 FX 转换，也不接触账户授权或交易。

```ts
import { buildHeatmapSnapshot } from '@finagent/shared';

const heatmap = buildHeatmapSnapshot({
  snapshotId: watchlistSnapshot.id,
  mode: 'watchlist',
  entries: watchlistSnapshot.entries.map((entry) => ({
    instrument: entry.instrument,
    sector: entry.sector,
    quote: quotesByInstrumentId.get(entry.instrument.instrumentId),
  })),
});
```

以上是调用方接线示意，`watchlistSnapshot` 和 `quotesByInstrumentId` 不是本 PR
新增的全局状态。未来 UI 需由现有列表层构造这些输入；不能把独立拉取的当前持仓
和旧行情混成一个新快照。`snapshotId` 只透传已有版本身份，不代表投影函数验证了
上游数据新鲜度。

## 已实现的语义

- 用 canonical `instrumentId` 去重，保留输入顺序。同 ticker 不同市场独立成格。
  重复项的名称、行业和报价取第一项；组合的所有 lot 估值累加，不能丢掉重复持仓。
- 自选按去重后的标的等面积。空行业单独归入 `sector: null`，不会推测行业。
- 报价必须由 `Quote.instrumentId` 或 `ProviderProvenance.instrumentId` 绑定到相同
  canonical 身份；两者冲突或缺少绑定时不输出涨跌幅，不用 provider ticker 猜身份。
- 缺报价、接口错误和非有限涨跌幅都输出 `changePercent: null`，真实平盘保留 0。
  保留实际 provider、原始报价时间、延迟/过期标记与 failover trail。
- 组合面积只使用账户边界已经提供的 `marketValueBase`，或明确与基准币种相同的
  `marketValue`。不把 HKD/USD 等原币金额直接相加，不推测基准币种或 FX。
- 负数量/负市值不取绝对值；缺少数量、不可比较的估值、空头、零分母或数值溢出
  均使组合所有 `areaWeight` 为 null，返回具体原因。不会把“有数据的部分”缩放成
  看似完整的 100%。单元格仍保留，可由后续 UI 以列表显示。
- 输出不修改输入，固定同一输入得到相同结果，无时钟和示例数据回退。

## 后续 UI 接线约束

这是 #333 的独立数据切片，不关闭整个 issue。尚未完成 treemap 布局、固定图例、
tooltip、键盘选择、进入公司研究、列表/热力图视图切换、真实 provider 演示及截图。
UI 必须把 `missing`、`error`、`identity-*`、`stale` 状态灰显或明确标记，不能把 null
转换为 0；延迟状态也必须可见。持仓权重分母是本次输入的完整所选持仓市值，
不包含未传入的现金，不代表账户净资产权重。

单元测试使用合成行情与持仓 fixture，包括 100 个标的的确定性投影与刷新后的
canonical 选择键稳定性；它不等于真实 provider、UI 渲染/请求性能或端到端验证。
