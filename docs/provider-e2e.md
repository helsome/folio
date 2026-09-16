# Live 双 Provider E2E

该检查只验证真实 Provider，不使用 mock。它分别创建 Longbridge 和 Massive 适配器，经过 `ProviderRouter` 执行共同能力 `market.quote`、`market.kline`、`company.profile`，并检查规范化结果和 `ProviderProvenance` 的 `providerId`、`fetchedAt`、`stale` 等字段。

## 前置条件

1. 安装 Longbridge CLI，并完成登录：`longbridge auth login`。
2. 设置 Massive API key。开发环境可使用 `MASSIVE_API_KEY`；兼容旧名称 `POLYGON_API_KEY`。
3. 使用美股标的，默认是 `AAPL.US`。可通过 `FINAGENT_PROVIDER_E2E_SYMBOL` 覆盖。

密钥只通过进程环境变量传给适配器，不会写入报告或日志。Massive 返回的数据可能带有延迟/日终属性，报告会保留其 `delayed` 来源标记。

## 运行

默认命令不会联网，也不会执行真实请求：

```sh
bun run test:provider-e2e
```

显式开启真实检查：

```sh
# PowerShell
$env:FINAGENT_PROVIDER_E2E = "1"
$env:MASSIVE_API_KEY = "你的密钥"
bun run test:provider-e2e
```

可选地将脱敏 JSON 报告写入文件：

```powershell
$env:FINAGENT_PROVIDER_E2E_OUTPUT = "artifacts/provider-e2e.json"
bun run test:provider-e2e
```

没有 Longbridge 登录、没有 Massive key、Provider 返回错误或规范化/来源校验失败时，命令以非零状态结束；不会把 `SKIPPED` 当作通过。普通 CI 只应运行 `bun run test:provider-e2e:guard`，真实 E2E 需要在具备两套凭据的受控环境中手动运行。

## 验收记录

提交真实验收结果时，应附上命令输出或脱敏 JSON，并记录 Bun 版本、操作系统/架构、执行时间和实际 Provider 状态。不要提交 API key、Longbridge 账户标识或供应商原始响应。
