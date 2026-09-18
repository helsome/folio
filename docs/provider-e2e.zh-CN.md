# 真实双 Provider E2E

该检查只访问真实 Provider，不使用 mock。它分别通过 `ProviderRouter` 调用 Longbridge 和 Massive 的共同能力：`market.quote`、`market.kline`、`company.profile`，并校验规范化结果及 `ProviderProvenance`。

## 前置条件

1. 安装 Longbridge CLI。Windows 可执行：

   ```powershell
   winget install --id Longbridge.LongbridgeTerminal --location "D:\Tools\Longbridge"
   ```

2. 打开新的 PowerShell 窗口，完成 Longbridge 登录：

   ```powershell
   longbridge auth login
   longbridge auth status --format json
   ```

   返回的 `token.status` 必须是 `valid`。如果当前窗口仍找不到命令，可临时执行：

   ```powershell
   $env:Path = "D:\Tools\Longbridge;$env:Path"
   ```

3. 在 [Massive](https://massive.com/) 控制台创建 API Key，并设置环境变量：

   ```powershell
   $env:MASSIVE_API_KEY = "你的 Massive API Key"
   ```

   兼容旧变量名 `POLYGON_API_KEY`。密钥只存在于当前进程环境，不会写入报告。

## 运行

默认不会联网：

```powershell
bun run test:provider-e2e
```

显式开启真实 E2E：

```powershell
$env:FINAGENT_PROVIDER_E2E = "1"
$env:FINAGENT_PROVIDER_E2E_SYMBOL = "AAPL.US"
bun run test:provider-e2e
```

可选保存脱敏 JSON：

```powershell
$env:FINAGENT_PROVIDER_E2E_OUTPUT = "artifacts/provider-e2e.json"
bun run test:provider-e2e
```

缺少任一凭据、Longbridge 未登录、Provider 返回错误，或规范化/来源校验失败时，命令以非零状态结束；不会将 `SKIPPED` 当作通过。普通 CI 使用 `bun run test:provider-e2e:guard`，真实 E2E 需要在具备两套凭据的受控环境中手动运行。

## 验收记录

提交真实验收结果时，应附上脱敏 JSON 或命令输出，并记录 Bun 版本、操作系统/架构、执行时间和两个 Provider 的实际状态。不得提交 API Key、Longbridge 账户标识或供应商原始响应。
