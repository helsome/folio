/** Built-in sample ("demo") content labels — shown with a `DemoBadge` wherever sample data renders. */
export const demo = {
  badge: 'Sample data',
  hint: 'Built-in sample content. Connect a market-data provider and an AI model in Settings to see your real data.',
  brief: {
    summary: '2 things need your attention today',
    quiet: '2 monitored securities stayed below the materiality bar.',
    riskTitle: 'AAPL regulatory risk may pressure Q4 margins',
    riskMessage:
      'A pending EU App Store ruling could slightly affect services margins. Suggested action: review the stress-test model.',
    rotationTitle: 'Sector rotation: tech momentum cooling',
    rotationMessage:
      'Technology momentum is slowing while healthcare shows defensive strength. Consider reviewing defensive allocations.',
  },
  events: {
    earningsName: 'AAPL Earnings Call (Q3)',
    earningsContent: 'Quarterly results and guidance call after market close.',
    macroName: 'PCE Inflation Data',
    macroContent: 'Core PCE release; a key inflation gauge for the Fed.',
    fomcName: 'FOMC Press Conference',
    fomcContent: 'Rate decision and forward guidance; watch the tone on inflation.',
  },
} as const;
