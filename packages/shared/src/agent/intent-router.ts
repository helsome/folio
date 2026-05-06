import type { AgentSessionSnapshot } from '@finagent/core';

export type FinanceIntent = 'quote' | 'kline' | 'portfolio' | 'portfolio_risk' | 'intraday' | 'unsupported';

export interface RoutedIntent {
  intent: FinanceIntent;
  text: string;
  symbol?: string;
}

const SYMBOL_REGEX = /\b[A-Z0-9]{1,5}\.(US|HK|SG|SH|SZ|HAS)\b/i;
const UNSUPPORTED_CONTENT =
  '当前 MVP 支持 quote/行情/价格、K-line/K线 和 portfolio/持仓/组合 查询。请带上标的代码，例如 AAPL.US 或 0700.HK。';

export function routeFinanceIntent(
  message: string,
  session?: AgentSessionSnapshot
): RoutedIntent {
  const text = message.trim();
  const normalized = text.toLowerCase();
  const explicitSymbol = extractSymbol(text);
  const symbol = explicitSymbol ?? session?.recentSymbols[0];

  if (hasAny(text, ['risk', '风险', '波动', 'volatility']) && hasAny(text, ['portfolio', '持仓', '组合'])) {
    return { intent: 'portfolio_risk', text };
  }

  if (hasAny(text, ['portfolio', '持仓', '组合'])) {
    return { intent: 'portfolio', text };
  }

  if (symbol && (normalized.includes('intraday') || text.includes('分时'))) {
    return { intent: 'intraday', text, symbol };
  }

  if (
    symbol &&
    (normalized.includes('kline') ||
      normalized.includes('k-line') ||
      normalized.includes('chart') ||
      text.includes('K线') ||
      text.includes('k线') ||
      text.includes('走势'))
  ) {
    return { intent: 'kline', text, symbol };
  }

  if (symbol && hasAny(text, ['quote', '行情', '价格', '多少钱', 'price'])) {
    return { intent: 'quote', text, symbol };
  }

  return { intent: 'unsupported', text };
}

export function unsupportedFinanceMessage() {
  return UNSUPPORTED_CONTENT;
}

export function extractSymbol(text: string) {
  return text.match(SYMBOL_REGEX)?.[0].toUpperCase();
}

function hasAny(text: string, needles: string[]) {
  const normalized = text.toLowerCase();
  return needles.some((needle) => normalized.includes(needle.toLowerCase()));
}
