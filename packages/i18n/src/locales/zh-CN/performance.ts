import type { SameKeysAs } from '../keys.ts';
import type { performance as enPerformance } from '../en-US/performance.ts';

/** Performance — Simplified Chinese (spec §36–42). */
export const performance = {
  title: '表现',
  horizon1W: '1 周',
  horizon1M: '1 个月',
  horizon3M: '3 个月',
  intro:
    '已评测研究观点的历史成绩。样本数低于 {{min}} 的组为「仅观察」— 绝不会以少量结果调参。',
  loading: '加载中…',

  skillPerformance: '技能表现',
  strategyPerformance: '策略表现',
  avgReturn: '平均回报',
  medianExcessReturn: '中位超额回报',
  noSkillOutcomes: '还没有已评测的技能结果。',
  noStrategyOutcomes: '还没有已评测的策略结果。',

  calibrationAdvanced: '校准（高级）',
  calibrationIntro:
    '仅供参考 — 每条历史成绩会如何调整权重，且绝不超出有界范围。此版本不会应用运行时权重。',
  skillCalibration: '技能校准',
  strategyCalibration: '策略校准',
  noCalibratedSkillOutcomes: '还没有已校准的技能结果。',
  noCalibratedStrategyOutcomes: '还没有已校准的策略结果。',
  finalWeightBounded: '最终权重限制在 [{{min}} – {{max}}]',
  calibrationNote: '仅供参考 — 样本数低于 {{min}} 时不会推导任何调整。',

  // Table headers
  name: '名称',
  samples: '样本数',
  hitRate: '命中率',
  unable: '无法评估',
  status: '状态',
  baseWeight: '基础权重',
  historicalAdjustment: '历史调整',
  finalBounded: '最终（有界）',

  // Observational badge
  observationalOnly: '仅观察',

  // Strategy preset display names (finished strategy ids → label).
  strategies: {
    comprehensive: '全面',
    value: '价值投资',
    growth: '成长',
    technical: '技术面',
    earnings: '财报',
    'event-driven': '事件驱动',
    'risk-review': '风险复核',
    income: '稳健收益',
  },
} satisfies SameKeysAs<typeof enPerformance>;
