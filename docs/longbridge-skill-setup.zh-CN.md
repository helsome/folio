> 本文是 [longbridge-skill-setup.md](longbridge-skill-setup.md) 的中文翻译；如有出入，以英文原文为准。

# LongBridge 技能安装指南

本文档引导你完成 Finance Agent 的 LongBridge 集成安装与配置。

---

## 1. LongBridge CLI 安装（用户要求）

**重要：** LongBridge CLI 是用户自行安装的依赖。本应用**不**随附该 CLI。

### 安装步骤

```bash
# 方式一：官方脚本安装（推荐）
curl -sSL https://open.longbridge.com/longbridge/longbridge-terminal/install | sh

# 方式二：Homebrew 安装（macOS）
brew install longbridge/openapi/longbridge

# 方式三：手动下载
# 访问 https://open.longbridge.com/skill/install.md 查看手动安装说明
```

### 认证

```bash
# 登录你的 LongBridge 账户
longbridge auth login

# 此命令会打开浏览器进行 OAuth 认证
# 令牌存储在 ~/.longbridge/openapi/tokens/

# 验证认证状态
longbridge check
```

### 验证

```bash
# 用一条简单行情测试
longbridge quote AAPL.US --format json

# 预期输出：
# {"symbol":"AAPL.US","name":"Apple Inc.","last_close":...,"open":...}
```

---

## 2. Claude Code LongBridge 技能

对于 Claude Code，请安装官方 LongBridge 技能：

```bash
npx skills add longbridge/developers -g -y
```

### 技能能力

安装后，Claude Code 可以：
- 获取实时股票行情
- 获取历史 K 线数据
- 查询投资组合与持仓
- 设置价格提醒
- 访问财经新闻

### 在 Claude Code 中验证

```
你：获取 AAPL 的当前行情
Claude：[使用 LongBridge 技能获取行情]
```

---

## 3. Finance Agent 集成

Finance Agent 通过 `longbridge-tools` 包调用 LongBridge CLI。Electron 主进程通过 `@finagent/shared` 中的 `MarketDataService` 调用它，因此自选清单与聊天共享缓存、请求合并与规范化错误。

### 架构

```
┌─────────────────────────────────────┐
│      本地 Finance Agent 后端         │
│  packages/shared/src/agent/         │
│                                     │
│  - IntentRouter                     │
│  - FinanceToolRegistry              │
│  - MarketDataService                │
└─────────────┬───────────────────────┘
              │ execa（安全）
              ▼
┌─────────────────────────────────────┐
│      LongBridge 工具                │
│  packages/longbridge-tools/src/     │
│                                     │
│  - executor.ts（execa 封装）        │
│  - validator.ts（标的校验）         │
│  - parser.ts（JSON 解析器）         │
└─────────────┬───────────────────────┘
              │ which + execa
              ▼
┌─────────────────────────────────────┐
│      LongBridge CLI                 │
│  （用户安装于 /usr/local/bin）      │
└─────────────────────────────────────┘
```

### 标的格式

LongBridge 使用特定的标的格式：

| 市场 | 示例 | 格式 |
|--------|---------|--------|
| 美股 | 苹果（Apple） | `AAPL.US` |
| 港股 | 腾讯（Tencent） | `0700.HK` |
| A 股（沪市） | 贵州茅台（Kweichow Moutai） | `600519.SH` |
| A 股（深市） | 泸州老窖（Luzhou Laojiao） | `000568.SZ` |
| 新加坡 | 星展银行（DBS） | `D05.SG` |
| 加密货币 | 比特币（Bitcoin） | `BTCUSD.HAS` |
| 指数 | VIX | `.VIX.US` |

---

## 4. 可用命令

### 行情数据

```bash
# 实时行情
longbridge quote SYMBOL --format json

# K 线（蜡烛图）数据
longbridge kline SYMBOL --period 1d --format json

# 盘中分钟数据
longbridge intraday SYMBOL --json

# Level 2 盘口
longbridge depth SYMBOL --json
```

### 投资组合

```bash
# 投资组合概览（含盈亏）
longbridge portfolio --format json

# 当前持仓
longbridge positions --format json

# 账户资产
longbridge assets --format json

# 现金流记录
longbridge cash-flow --format json
```

### 财务数据

```bash
# 估值指标（PE、PB 等）
longbridge calc-index SYMBOL --json

# 分红历史
longbridge dividend SYMBOL --json

# 分析师评级
longbridge institution-rating SYMBOL --json

# 财务报告
longbridge financial-report SYMBOL --json
```

### 提醒

```bash
# 列出所有提醒
longbridge alert --list

# 创建价格提醒
longbridge alert --add --symbol SYMBOL --price 250

# 删除提醒
longbridge alert --del --id ALERT_ID
```

### 新闻

```bash
# 标的的最新新闻
longbridge news SYMBOL --json

# 获取完整文章
longbridge news SYMBOL --id ARTICLE_ID
```

---

## 5. 错误处理

### 错误码

| 错误码 | 含义 | 解决方案 |
|------------|---------|----------|
| `LONGBRIDGE_NOT_INSTALLED` | 未找到 CLI | 运行 `curl -sSL https://open.longbridge.com/.../install \| sh` |
| `LONGBRIDGE_NOT_AUTHED` | 未登录 | 运行 `longbridge auth login` |
| `LONGBRIDGE_TIMEOUT` | 命令超时 | 重试或检查网络 |
| `LONGBRIDGE_INVALID_SYMBOL` | 标的未知 | 检查标的格式 |
| `LONGBRIDGE_RATE_LIMIT` | 请求过于频繁 | 稍等再重试 |

### 故障排查

```bash
# 检查 longbridge 是否已安装
which longbridge

# 检查认证状态
longbridge check

# 查看帮助
longbridge --help

# 查看详细输出（用于调试）
longbridge quote AAPL.US --format json -v
```

---

## 6. 速率限制

LongBridge API 存在速率限制：

- **行情查询：** 约 100 次/分钟
- **投资组合查询：** 约 30 次/分钟
- **提醒操作：** 约 20 次/分钟

应用通过缓存减少 API 调用：
- 行情数据：30 秒缓存
- 财务数据：5 分钟缓存
- 投资组合数据：2 分钟缓存

---

## 7. 快速参考

```bash
# 完整安装清单
curl -sSL https://open.longbridge.com/longbridge/longbridge-terminal/install | sh
longbridge auth login
longbridge check
longbridge quote AAPL.US --format json

# Claude Code 技能安装
npx skills add longbridge/developers -g -y
```

---

## 链接

- [LongBridge 官方网站](https://longbridge.com)
- [LongBridge 技能安装](https://open.longbridge.com/skill/install.md)
- [LongBridge 文档](https://open.longbridge.com/docs)
