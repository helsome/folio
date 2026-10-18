# Yahoo Finance 行情

在未配置 Longbridge 或 Massive 时，Folio 也可以从 Yahoo Finance 获取**美股报价、日/周 K 线，以及简要公司资料**，无需 API 密钥。

## 这是什么

- **免费且非官方。** 适配器调用 Yahoo 的公开 chart 接口（`query1.finance.yahoo.com/v8/finance/chart`）。它不是 Yahoo 的正式 API，没有合同、SLA 或支持。
- **延迟行情。** 成功结果都会标为延迟数据，不是实时行情。
- **仅供个人使用。** Yahoo 的条款将这类访问限制为个人用途。请勿再分发这些数据，也不要把它当作商业行情源对外提供。
- **仅美股。** 港股、A 股和新加坡标的仍走 Longbridge。指数代码（例如 `SPX`）会映射到 Yahoo 的指数代码（`^GSPC`）。
- **仅日 K 与周 K。** 分钟级周期仍由实际支持它们的提供方处理。

该接口可能随时变更、拦截客户端或限流。Folio 会把成功响应缓存约一分钟，并发送常见的浏览器 User-Agent，因为空的 User-Agent 会被拒绝。

## 如何启用

Yahoo 会自动注册，不需要环境变量。

1. 打开 **设置 → 连接**。
2. Yahoo Finance 无需密钥即可使用。卡片上会说明延迟、非官方和个人使用限制。
3. 保持默认即可把它当作**备用源**：Longbridge 是主源，Massive 是已配置的后备，当前两者失败或未配置时，Yahoo 会回答美股报价、K 线与公司资料请求。
4. 在 Yahoo 卡片上选择 **设为主数据源** 或 **设为备用数据源**，可以把它提前到链路中。用启用开关或 **断开** 关闭它。**测试连接** 会请求 `AAPL.US`。

报价、K 线、自选和对比上的新鲜度文案会显示实际返回数据的提供方（`Yahoo Finance`、`Longbridge` 或 `Massive (Polygon.io)`），延迟数据也会标明。
