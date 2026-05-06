# LongBridge CLI API Reference

Complete reference for all LongBridge CLI commands used by Finance Agent.

---

## Symbol Format Reference

| Market | Suffix | Example | Notes |
|--------|--------|---------|-------|
| US Stocks | `.US` | `AAPL.US`, `TSLA.US` | Most common |
| HK Stocks | `.HK` | `0700.HK`, `9988.HK` | Hong Kong |
| China A (Shanghai) | `.SH` | `600519.SH`, `600036.SH` | Shanghai Stock Exchange |
| China A (Shenzhen) | `.SZ` | `000568.SZ`, `000858.SZ` | Shenzhen Stock Exchange |
| Singapore | `.SG` | `D05.SG`, `泰.CT` | Singapore Exchange |
| Indices | `.US` | `.VIX.US`, `.SPX.US` | Start with `.` |
| Crypto | `.HAS` | `BTCUSD.HAS` | LongBridge crypto suffix |

---

## Market Data Commands

### 1. Quote (实时报价)

```bash
longbridge quote SYMBOL --format json
```

**Example:**
```bash
longbridge quote TSLA.US --format json
```

**Output:**
```json
{
  "symbol": "TSLA.US",
  "name": "Tesla, Inc.",
  "last_close": 248.50,
  "open": 245.00,
  "price": 252.30,
  "change": 3.80,
  "change_rate": 0.0153,
  "volume": 98500000,
  "turnover": 24850000000,
  "amplitude": 0.0327,
  "market_cap": 801000000000,
  "pe_ratio": 78.50,
  "pcf_ratio": null,
  "timestamp": 1714825800
}
```

**Response Fields:**
| Field | Type | Description |
|-------|------|-------------|
| `symbol` | string | Stock symbol |
| `name` | string | Company name |
| `last_close` | number | Yesterday's close price |
| `open` | number | Today's open price |
| `price` | number | Current price |
| `change` | number | Price change |
| `change_rate` | number | Change percentage (decimal) |
| `volume` | number | Trading volume |
| `turnover` | number | Trading turnover |
| `amplitude` | number | Amplitude percentage |
| `pe_ratio` | number | P/E ratio |
| `market_cap` | number | Market capitalization |

---

### 2. K-Line (K线数据)

```bash
longbridge kline SYMBOL --period PERIOD --format json
```

**Parameters:**
| Parameter | Values | Default | Description |
|-----------|--------|---------|-------------|
| `--period` | `1m`, `5m`, `15m`, `30m`, `1h`, `4h`, `1d`, `1w`, `1M` | `1d` | Time period |
| `--adjust` | `none`, `前复权`, `后复权` | `none` | Price adjustment |

**Example:**
```bash
longbridge kline TSLA.US --period 1d --format json
```

**Output:**
```json
[
  {
    "timestamp": 1714521600,
    "open": 172.50,
    "close": 175.20,
    "high": 176.80,
    "low": 171.00,
    "volume": 85000000
  },
  {
    "timestamp": 1714608000,
    "open": 175.20,
    "close": 178.50,
    "high": 180.00,
    "low": 174.50,
    "volume": 92000000
  }
]
```

---

### 3. Intraday (分时数据)

```bash
longbridge intraday SYMBOL --json
```

**Example:**
```bash
longbridge intraday TSLA.US --json
```

**Output:**
```json
[
  {
    "timestamp": 1714566600,
    "price": 172.50,
    "volume": 12500,
    "turnover": 2156250
  },
  {
    "timestamp": 1714567500,
    "price": 173.20,
    "volume": 8700,
    "turnover": 1506840
  }
]
```

---

### 4. Depth (买卖盘口)

```bash
longbridge depth SYMBOL --json
```

**Example:**
```bash
longbridge depth TSLA.US --json
```

**Output:**
```json
{
  "asks": [
    { "price": 252.35, "volume": 1500 },
    { "price": 252.36, "volume": 2300 },
    { "price": 252.37, "volume": 800 }
  ],
  "bids": [
    { "price": 252.34, "volume": 1200 },
    { "price": 252.33, "volume": 3400 },
    { "price": 252.32, "volume": 1500 }
  ]
}
```

---

## Portfolio Commands

### 5. Portfolio (投资组合)

```bash
longbridge portfolio --format json
```

**Example:**
```bash
longbridge portfolio --format json
```

**Output:**
```json
{
  "total_assets": 150000.00,
  "cash": 25000.00,
  "market_value": 125000.00,
  "total_profit": 15000.00,
  "total_profit_rate": 0.1111,
  "today_profit": -500.00,
  "today_profit_rate": -0.0033
}
```

---

### 6. Positions (持仓列表)

```bash
longbridge positions --format json
```

**Example:**
```bash
longbridge positions --format json
```

**Output:**
```json
[
  {
    "symbol": "TSLA.US",
    "name": "Tesla, Inc.",
    "quantity": 50,
    "available_quantity": 50,
    "avg_price": 220.50,
    "cost": 11025.00,
    "market_value": 12615.00,
    "profit": 1590.00,
    "profit_rate": 0.1443,
    "today_profit": -125.00,
    "today_profit_rate": -0.0098
  },
  {
    "symbol": "AAPL.US",
    "name": "Apple Inc.",
    "quantity": 100,
    "available_quantity": 100,
    "avg_price": 175.00,
    "cost": 17500.00,
    "market_value": 18200.00,
    "profit": 700.00,
    "profit_rate": 0.0400,
    "today_profit": 100.00,
    "today_profit_rate": 0.0055
  }
]
```

---

### 7. Assets (账户资产)

```bash
longbridge assets --format json
```

**Output:**
```json
{
  "currency": "USD",
  "total_assets": 150000.00,
  "cash": 25000.00,
  "buy_power": 50000.00,
  "market_value": 125000.00,
  "profit": 15000.00
}
```

---

## Financial Commands

### 8. Calc Index (财务指标)

```bash
longbridge calc-index SYMBOL --json
```

**Example:**
```bash
longbridge calc-index TSLA.US --json
```

**Output:**
```json
{
  "symbol": "TSLA.US",
  "name": "Tesla, Inc.",
  "pe_ratio": 78.50,
  "pb_ratio": 9.25,
  "pcf_ratio": null,
  "dividend_yield": null,
  "dps": null,
  "total_revenue": 96730000000,
  "net_profit": 1500000000,
  "market_cap": 801000000000,
  "shares": 3177000000
}
```

---

### 9. Dividend (分红历史)

```bash
longbridge dividend SYMBOL --json
```

---

### 10. Institution Rating (分析师评级)

```bash
longbridge institution-rating SYMBOL --json
```

**Output:**
```json
{
  "symbol": "TSLA.US",
  "name": "Tesla, Inc.",
  "rating": "买入",
  "rating_count": 42,
  "institutions": [
    {
      "name": "Morgan Stanley",
      "rating": "增持",
      "target_price": 280.00
    }
  ],
  "avg_target_price": 265.50
}
```

---

## Alert Commands

### 11. Alert List (告警列表)

```bash
longbridge alert --list
```

**Output:**
```json
[
  {
    "id": "alert_001",
    "symbol": "TSLA.US",
    "type": "price_above",
    "price": 250.00,
    "status": "active",
    "created_at": 1714566600
  }
]
```

### 12. Create Alert (创建告警)

```bash
longbridge alert --add --symbol SYMBOL --price PRICE
```

**Example:**
```bash
longbridge alert --add --symbol TSLA.US --price 250
```

### 13. Delete Alert (删除告警)

```bash
longbridge alert --del --id ALERT_ID
```

---

## News Commands

### 14. News (新闻资讯)

```bash
longbridge news SYMBOL --json
```

**Example:**
```bash
longbridge news TSLA.US --json
```

**Output:**
```json
[
  {
    "id": "news_12345",
    "title": "Tesla Announces New Factory in India",
    "summary": "Tesla Inc. announced plans to build a new gigafactory in India...",
    "source": "Reuters",
    "publish_at": 1714566600,
    "url": "https://example.com/news/12345"
  }
]
```

---

## Utility Commands

### 15. Market Status (市场状态)

```bash
longbridge market-status --json
```

**Output:**
```json
{
  "US": { "status": "open", "trading_session": "Regular" },
  "HK": { "status": "closed", "trading_session": "Pre-market" },
  "CN": { "status": "closed", "trading_session": "After-hours" }
}
```

---

### 16. Check Auth (验证连接)

```bash
longbridge check
```

**Output:**
```
✓ Connection successful
✓ Account authenticated
✓ API quota: 1000/1000 requests
```

---

## Error Codes Reference

| Exit Code | Meaning | Action |
|-----------|---------|--------|
| 0 | Success | - |
| 1 | General error | Check command syntax |
| 2 | Authentication failed | Run `longbridge auth login` |
| 3 | Rate limited | Wait and retry |
| 4 | Network error | Check internet connection |
| 5 | Invalid symbol | Verify symbol format |

---

## JavaScript/TypeScript Integration

```typescript
import { execa } from 'execa';

// Safe execution wrapper
async function execLongBridge(args: string[]): Promise<string> {
  const { stdout, stderr } = await execa('longbridge', [...args, '--format', 'json'], {
    timeout: 10000,
  });
  return stdout;
}

// Get quote
const quote = await execLongBridge(['quote', 'TSLA.US']);
const quoteData = JSON.parse(quote);

// Get portfolio
const portfolio = await execLongBridge(['portfolio']);
const portfolioData = JSON.parse(portfolio);
```
