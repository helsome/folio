import type { NamespaceResource } from '../keys.ts';

/**
 * Thesis (investment thesis) surface — thesis cards, editor, impact history
 * (V8 spec §30). Thesis prose and user-authored content are never translated
 * (§12–13); only the surrounding UI chrome is localised.
 */
export const thesis = {
  thesis: 'Thesis',
  saveAsThesis: 'Save as Thesis',
  selectSymbol: 'Select a symbol to view its investment thesis.',
  noReportFor: 'No research report yet. Run Deep Research for {{symbol}} to save a thesis.',
  noneSaved: 'No thesis saved.',
  reEvaluateComplete: 'Re-evaluation complete — see the impact below.',
  reEvaluationHistory: 'Re-evaluation history',
  lastReviewed: 'Last reviewed {{date}}',
  edit: 'Edit',
  reEvaluate: 'Re-evaluate',
  bull: 'Bull',
  bear: 'Bear',
  catalysts: 'Catalysts',
  risks: 'Risks',
  stance: {
    bullish: 'Bullish',
    bearish: 'Bearish',
    neutral: 'Neutral',
  },
  empty: {
    title: 'Track your investment logic',
    subtitle: 'Run Deep Research on a stock, then save the conclusion here.',
    goResearch: 'Start Research',
  },
  monitor: 'Monitor',
  monitoredHint: 'You will be notified when important things change.',
  editor: {
    stance: 'Stance',
    coreThesis: 'Core thesis',
    bullCase: 'Bull case',
    bearCase: 'Bear case',
    catalysts: 'Catalysts',
    risks: 'Risks',
    onePointPerLine: 'One point per line',
    targetPriceOptional: 'Target price (optional)',
    targetPricePlaceholder: 'e.g. 250.00',
    saving: 'Saving…',
  },
  impact: {
    noneYet: 'No re-evaluations yet.',
    unchanged: 'Unchanged',
    strengthened: 'Strengthened',
    weakened: 'Weakened',
    invalidated: 'Invalidated',
  },
} satisfies NamespaceResource;
