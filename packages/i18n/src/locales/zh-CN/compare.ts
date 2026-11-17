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
  savedViews: {
    label: '已保存视图',
    placeholder: '选择一个视图',
    namePlaceholder: '视图名称（可选）',
    save: '保存视图',
    delete: '删除已保存视图',
  },
  viewSettings: {
    metrics: '指标',
    returnWindow: '回报区间',
    compactRows: '紧凑行',
    presets: {
      all: '全部指标',
      priceReturns: '价格与回报',
      valuation: '估值',
      fundamentals: '基本面',
    },
    windows: {
      all: '全部',
      oneMonth: '1个月',
      threeMonths: '3个月',
      oneYear: '1年',
    },
  },
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
