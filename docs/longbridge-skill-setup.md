# LongBridge Skill Setup Guide

This document guides you through installing and configuring the LongBridge integration for Finance Agent.

---

## 1. LongBridge CLI Installation (User Requirement)

**Important:** LongBridge CLI is a user-installed dependency. The app does NOT bundle this CLI.

### Installation Steps

```bash
# Option 1: Install via official script (recommended)
curl -sSL https://open.longbridge.com/longbridge/longbridge-terminal/install | sh

# Option 2: Via Homebrew (macOS)
brew install longbridge/openapi/longbridge

# Option 3: Manual download
# Visit https://open.longbridge.com/skill/install.md for manual installation
```

### Authentication

```bash
# Login to your LongBridge account
longbridge auth login

# This will open a browser for OAuth authentication
# Token is stored at ~/.longbridge/openapi/tokens/

# Verify authentication
longbridge check
```

### Verification

```bash
# Test with a simple quote
longbridge quote AAPL.US --format json

# Expected output:
# {"symbol":"AAPL.US","name":"Apple Inc.","last_close":...,"open":...}
```

---

## 2. Claude Code LongBridge Skill

For Claude Code, install the official LongBridge skill:

```bash
npx skills add longbridge/developers -g -y
```

### Skill Capabilities

After installation, Claude Code can:
- Get real-time stock quotes
- Fetch historical K-line data
- Query portfolio and positions
- Set price alerts
- Access financial news

### Verification in Claude Code

```
You: Get the current quote for AAPL
Claude: [Uses LongBridge skill to fetch quote]
```

---

## 3. Finance Agent Integration

Finance Agent uses LongBridge CLI through the `longbridge-tools` package.

### Architecture

```
┌─────────────────────────────────────┐
│      Pi Agent Extension             │
│  packages/pi-extension/src/         │
│                                     │
│  Tools:                             │
│  - get_quote                        │
│  - get_kline                        │
│  - get_portfolio                    │
│  - create_alert                     │
└─────────────┬───────────────────────┘
              │ execa (safe)
              ▼
┌─────────────────────────────────────┐
│      LongBridge Tools               │
│  packages/longbridge-tools/src/     │
│                                     │
│  - executor.ts (execa wrapper)      │
│  - validator.ts (symbol check)     │
│  - parser.ts (JSON parser)          │
└─────────────┬───────────────────────┘
              │ which + execa
              ▼
┌─────────────────────────────────────┐
│      LongBridge CLI                 │
│  (User-installed at /usr/local/bin) │
└─────────────────────────────────────┘
```

### Symbol Format

LongBridge uses a specific symbol format:

| Market | Example | Format |
|--------|---------|--------|
| US Stocks | Apple | `AAPL.US` |
| HK Stocks | Tencent | `0700.HK` |
| China A (SH) | Kweichow Moutai | `600519.SH` |
| China A (SZ) | Luzhou Laojiao | `000568.SZ` |
| Singapore | DBS | `D05.SG` |
| Crypto | Bitcoin | `BTCUSD.HAS` |
| Indices | VIX | `.VIX.US` |

---

## 4. Available Commands

### Market Data

```bash
# Real-time quote
longbridge quote SYMBOL --format json

# K-line (candlestick) data
longbridge kline SYMBOL --period 1d --json

# Intraday minute data
longbridge intraday SYMBOL --json

# Level 2 order book
longbridge depth SYMBOL --json
```

### Portfolio

```bash
# Portfolio overview with P/L
longbridge portfolio --format json

# Current positions
longbridge positions --format json

# Account assets
longbridge assets --format json

# Cash flow records
longbridge cash-flow --format json
```

### Financial Data

```bash
# Valuation metrics (PE, PB, etc.)
longbridge calc-index SYMBOL --json

# Dividend history
longbridge dividend SYMBOL --json

# Analyst ratings
longbridge institution-rating SYMBOL --json

# Financial reports
longbridge financial-report SYMBOL --json
```

### Alerts

```bash
# List all alerts
longbridge alert --list

# Create price alert
longbridge alert --add --symbol SYMBOL --price 250

# Delete alert
longbridge alert --del --id ALERT_ID
```

### News

```bash
# Latest news for symbol
longbridge news SYMBOL --json

# Get full article
longbridge news SYMBOL --id ARTICLE_ID
```

---

## 5. Error Handling

### Error Codes

| Error Code | Meaning | Solution |
|------------|---------|----------|
| `LONGBRIDGE_NOT_INSTALLED` | CLI not found | Run `curl -sSL https://open.longbridge.com/.../install \| sh` |
| `LONGBRIDGE_NOT_AUTHED` | Not logged in | Run `longbridge auth login` |
| `LONGBRIDGE_TIMEOUT` | Command timed out | Retry or check network |
| `LONGBRIDGE_INVALID_SYMBOL` | Unknown symbol | Check symbol format |
| `LONGBRIDGE_RATE_LIMIT` | Too many requests | Wait before retry |

### Troubleshooting

```bash
# Check if longbridge is installed
which longbridge

# Check authentication status
longbridge check

# View help
longbridge --help

# View verbose output (for debugging)
longbridge quote AAPL.US --format json -v
```

---

## 6. Rate Limits

LongBridge API has rate limits:

- **Quote queries:** ~100 requests/minute
- **Portfolio queries:** ~30 requests/minute
- **Alert operations:** ~20 requests/minute

The app implements caching to reduce API calls:
- Quote data: 30-second cache
- Financial data: 5-minute cache
- Portfolio data: 2-minute cache

---

## 7. Quick Reference

```bash
# Full installation checklist
curl -sSL https://open.longbridge.com/longbridge/longbridge-terminal/install | sh
longbridge auth login
longbridge check
longbridge quote AAPL.US --format json

# Claude Code skill installation
npx skills add longbridge/developers -g -y
```

---

## Links

- [LongBridge Official Site](https://longbridge.com)
- [LongBridge Skill Install](https://open.longbridge.com/skill/install.md)
- [LongBridge Documentation](https://open.longbridge.com/docs)
