import type { SameKeysAs } from '../keys.ts';
import type { compare as enCompare } from '../en-US/compare.ts';

/** Compare slice (spec §32) — Simplified Chinese (glossary-aligned). */
export const compare = {
  metric: '指标',
  title: '对比标的（2–4）',
  symbolPlaceholder: '代码，例如 AAPL.US',
  addTwo: '至少添加两个标的以生成对比。',
  agentContext: '当对比工作台处于焦点时，Agent 上下文会携带这些标的。',
  unavailable: '当前环境无法进行对比。',
  metrics: {
    price: '价格',
    marketCap: '市值',
    pe: '市盈率',
    pb: '市净率',
    revenueGrowth: '营收增长',
    grossMargin: '毛利率',
    roe: '净资产收益率',
    dividendYield: '股息率',
    return1m: '1个月回报',
    return3m: '3个月回报',
    return1y: '1年回报',
    analystRating: '分析师评级',
    momentum: '动量',
  },
} satisfies SameKeysAs<typeof enCompare>;
