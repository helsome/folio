import type { NamespaceResource } from '../keys.ts';

/** Performance (spec §36–42): skill & strategy track records + calibration. */
export const performance = {
  title: 'Performance',
  horizon1W: '1 Week',
  horizon1M: '1 Month',
  horizon3M: '3 Months',
  intro:
    'Track record of evaluated research opinions. Groups below {{min}} samples are Observational Only — never tuned on a handful of outcomes.',
  loading: 'Loading…',

  skillPerformance: 'Skill Performance',
  strategyPerformance: 'Strategy Performance',
  avgReturn: 'Avg Return',
  medianExcessReturn: 'Median Excess Return',
  noSkillOutcomes: 'No evaluated skill outcomes yet.',
  noStrategyOutcomes: 'No evaluated strategy outcomes yet.',

  calibrationAdvanced: 'Calibration (Advanced)',
  calibrationIntro:
    'Informational only — how each track record would adjust a weight, never outside the bounded range. Runtime weighting is not applied in this version.',
  skillCalibration: 'Skill Calibration',
  strategyCalibration: 'Strategy Calibration',
  noCalibratedSkillOutcomes: 'No calibrated skill outcomes yet.',
  noCalibratedStrategyOutcomes: 'No calibrated strategy outcomes yet.',
  finalWeightBounded: 'Final weight bounded to [{{min}} – {{max}}]',
  calibrationNote: 'Informational only — below {{min}} samples no adjustment is derived.',

  // Table headers
  name: 'Name',
  samples: 'Samples',
  hitRate: 'Hit Rate',
  unable: 'Unable',
  status: 'Status',
  baseWeight: 'Base Weight',
  historicalAdjustment: 'Historical Adjustment',
  finalBounded: 'Final (Bounded)',

  // Observational badge
  observationalOnly: 'Observational Only',

  // Strategy preset display names (finished strategy ids → label).
  strategies: {
    comprehensive: 'Comprehensive',
    value: 'Value',
    growth: 'Growth',
    technical: 'Technical',
    earnings: 'Earnings',
    'event-driven': 'Event-Driven',
    'risk-review': 'Risk Review',
    income: 'Income',
  },
} satisfies NamespaceResource;
