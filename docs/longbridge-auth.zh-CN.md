> 本文是 [longbridge-auth.md](longbridge-auth.md) 的中文翻译；如有出入，以英文原文为准。

# Longbridge 认证 — V4 决策（Lead，规格 §8–11）

## 决策：CLI 设备授权流程，由主进程编排

Longbridge CLI 0.17.0（已在本地验证）提供了应用内、无需终端连接流程所需的一切：

- `longbridge auth login --format json` — 默认采用设备授权流程（RFC 8628）：打印一个 `verification_uri`，用户在任意浏览器中打开该地址，CLI 轮询直至完成授权。无需 localhost 回调。（`--auth-code` 流程也存在，但要求浏览器与 CLI 在同一台机器上，并需要 localhost 监听器——请勿使用。）
- `longbridge auth status --format json` →
  `{ account: { account_no, account_type, member_id, name, quote_level },
     token: { logged_in_at, path, status: "valid" | … } }`
  — 连接健康状态与权限来源。`quote_level` 编码了按市场划分的权限（例如 `USAB:…|Global|Delay` = 美股延迟行情；`HKAA:…|Global|LV2` = 港股二级行情）。将其解析为 `ProviderPermission[]`。
- `longbridge auth logout` — 清除已存储的令牌（断开连接）。
- `longbridge check --format json` → `{ connectivity: {cn, global}, region:
  {active}, session: {token, detail} }` — 测试连接 + 诊断。
- `longbridge --version` → `longbridge 0.17.0` — 安装状态 + 诊断。

## 流程（连接界面 → 主进程）

1. `Connections → Longbridge → Connect` → 主进程运行 `longbridge auth login
   --format json`，解析 `verification_uri`，用 `shell.openExternal` 打开它，并报告 `connecting` 状态。
2. 主进程轮询 `longbridge auth status --format json`（例如每 3 秒一次，超时 180 秒），直到 `token.status === 'valid'` → 变为 `connected` 并生成健康快照（账户身份、权限、区域）。
3. 超时 / 用户取消 → 终止登录进程，状态为 `not-connected`（若之前已存在令牌，则为 `expired`）。
4. 断开连接 → `longbridge auth logout` → `not-connected`。
5. CLI 缺失 → `not-installed`；界面显示 [Install / Setup]，点击后打开 Longbridge 官方安装文档（绝不 curl|sh）。

渲染进程绝不派生 shell；所有 CLI 交互都保留在主进程中（与现有 executor 相同的模式）。

## 权限 → 状态映射（规格 §8）

- 令牌缺失 → `not-connected`
- 登录进行中 → `connecting`
- 令牌有效，且所有预期权限都存在 → `connected`
- 令牌有效，但 `quote_level` 显示仅延迟行情或缺少某些市场 →
  `permission-limited`（`permissions[]` 携带详细信息）
- 令牌状态无效（已过期/已撤销）→ `expired`
- status/check 命令失败 → `error`（错误消息须对用户安全）

## 给 connector 的注意事项

`quote_level` 的值带市场前缀（SHAB/HKAB/USAB/SZAD/…）。将已知前缀映射到市场（US/HK/CN/SG），并把 `Delay`/`LV0` 视为延迟行情权限条目。未知值：以 `granted=false` 加原始标签原样透传——绝不虚构。
