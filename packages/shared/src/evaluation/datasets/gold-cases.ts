// Folio Gold Case Dataset — precise factual correctness tests (issue #15).
//
// These cases test exact factual correctness: the agent must return specific
// numbers, use specific tools, and ground its answer in evidence. Unlike the
// broad benchmark (folio-agent-v1), gold cases have a clear "right answer"
// that can be checked deterministically.
//
// Used for:
//   - CI smoke gates: every gold case must pass after any model/prompt change
//   - Regression detection: if a gold case starts failing, something broke
//   - Onboarding: new developers can run these to verify the agent works

import type { EvaluationDataset, EvaluationCase } from '@finagent/core';

const QUOTE_FRESH = 15 * 60 * 1000;

// ── Gold Cases ──────────────────────────────────────────────────────────────

const goldCases: EvaluationCase[] = [
  // 1. Basic quote with exact price expectation
  {
    id: 'gold-market-001',
    name: 'Quote must use get_quote and report last price',
    category: 'market',
    difficulty: 'golden',
    input: {
      prompt: 'What is NVDA trading at right now?',
      workspaceContext: { activeSymbol: 'NVDA.US', activeView: 'overview' },
    },
    expected: {
      requiredCapabilities: ['market.quote'],
      forbiddenCapabilities: ['market.kline', 'market.intraday', 'portfolio.summary'],
      maxToolCalls: 2,
      mustHaveEvidence: true,
      freshnessRequirementMs: QUOTE_FRESH,
      expectedAnswerHint:
        'Report the last price from get_quote. Must mention the price in USD, the day change, and volume. Do not use kline/intraday for a current price question.',
      expectedAnswer:
        'The answer must include: (1) the last price number from the quote result, (2) the change or changePercent, (3) evidence that get_quote was called. Must NOT make up a price or use historical data.',
    },
    tags: ['gold', 'quote', 'basic'],
    source: 'hand-authored',
  },

  // 2. Valuation ratio must come from valuation tool, not computed from quote
  {
    id: 'gold-valuation-001',
    name: 'PE ratio must come from get_valuation, not computed manually',
    category: 'tool-arguments',
    difficulty: 'golden',
    input: {
      prompt: 'What is the P/E ratio of AAPL?',
      workspaceContext: { activeSymbol: 'AAPL.US' },
    },
    expected: {
      requiredCapabilities: ['company.valuation'],
      forbiddenCapabilities: ['market.quote'],
      maxToolCalls: 2,
      mustHaveEvidence: true,
      expectedAnswerHint:
        'Must call get_valuation (or company.valuation capability) to get the PE ratio. Must NOT compute PE from price and EPS manually. Must report the PE number from the valuation tool result.',
      expectedAnswer:
        'The answer must include the PE ratio from get_valuation. Must NOT say "I calculated PE from price and EPS". Must have evidence of the valuation tool call.',
    },
    tags: ['gold', 'valuation', 'tool-selection'],
    source: 'hand-authored',
  },

  // 3. Historical price range must use kline, not quote
  {
    id: 'gold-kline-001',
    name: 'Multi-month historical range must use kline tool',
    category: 'tool-selection',
    difficulty: 'golden',
    input: {
      prompt: 'What was Tesla\'s stock price range over the last 3 months?',
      workspaceContext: { activeSymbol: 'TSLA.US' },
    },
    expected: {
      requiredCapabilities: ['market.kline'],
      forbiddenCapabilities: ['market.quote'],
      maxToolCalls: 3,
      mustHaveEvidence: true,
      expectedAnswerHint:
        'Must call get_kline (or market.kline) to get historical bars over 3 months. Must NOT use get_quote which only returns current price. Must report the high and low from the kline data.',
      expectedAnswer:
        'The answer must include: (1) evidence of kline/historical data call, (2) a high and low price range for the period, (3) the period covered. Must NOT use a single quote for a historical range question.',
    },
    tags: ['gold', 'kline', 'historical', 'tool-selection'],
    source: 'hand-authored',
  },

  // 4. Freshness: news must be recent, not old
  {
    id: 'gold-grounded-001',
    name: 'News must be recent and grounded in evidence',
    category: 'grounded',
    difficulty: 'golden',
    input: {
      prompt: 'What is the latest news about Microsoft?',
      workspaceContext: { activeSymbol: 'MSFT.US' },
    },
    expected: {
      requiredCapabilities: ['research.news'],
      maxToolCalls: 2,
      mustHaveEvidence: true,
      expectedAnswerHint:
        'Must call get_news (or research.news) to fetch recent news. Must NOT fabricate news. Must report headlines from the news tool result with their timestamps.',
      expectedAnswer:
        'The answer must include: (1) evidence of news tool call, (2) actual headlines from the news result, (3) timestamps or dates for the news. Must NOT invent news headlines.',
    },
    tags: ['gold', 'news', 'grounded'],
    source: 'hand-authored',
  },

  // 5. Symbol normalization: lowercase input must work
  {
    id: 'gold-symbol-001',
    name: 'Lowercase symbol must be normalized correctly',
    category: 'tool-arguments',
    difficulty: 'regression',
    input: {
      prompt: 'what is the current price of msft?',
    },
    expected: {
      requiredCapabilities: ['market.quote'],
      maxToolCalls: 2,
      mustHaveEvidence: true,
      freshnessRequirementMs: QUOTE_FRESH,
      expectedAnswerHint:
        'Must normalize "msft" to "MSFT.US" before calling get_quote. Regression: lowercase symbols previously caused errors or empty results.',
      expectedAnswer:
        'The answer must report a valid MSFT price. Must have called get_quote with the normalized symbol (MSFT.US).',
    },
    tags: ['gold', 'regression', 'symbol-normalization'],
    source: 'regression-bug',
  },

  // 6. Portfolio context: when user asks about their portfolio
  {
    id: 'gold-portfolio-001',
    name: 'Portfolio question must use portfolio tools, not public quote',
    category: 'portfolio',
    difficulty: 'golden',
    input: {
      prompt: 'What is my total portfolio value?',
      workspaceContext: { activeView: 'portfolio' },
    },
    expected: {
      requiredCapabilities: ['portfolio.summary'],
      forbiddenCapabilities: ['market.quote'],
      maxToolCalls: 2,
      mustHaveEvidence: true,
      expectedAnswerHint:
        'Must call get_portfolio (or portfolio.summary) to get the user\'s actual portfolio value. Must NOT look up a single stock\'s quote and pretend it\'s the portfolio total.',
      expectedAnswer:
        'The answer must include the total portfolio value from the portfolio tool. Must have evidence of portfolio.summary call.',
    },
    tags: ['gold', 'portfolio', 'tool-selection'],
    source: 'hand-authored',
  },

  // 7. No hallucination: if data unavailable, say so
  {
    id: 'gold-grounded-002',
    name: 'Honest about missing data, no fabrication',
    category: 'grounded',
    difficulty: 'golden',
    input: {
      prompt: 'What is the dividend yield of a company with no dividend history?',
      workspaceContext: { activeSymbol: 'UNKNOWN.US' },
    },
    expected: {
      maxToolCalls: 3,
      expectedAnswerHint:
        'If the valuation tool returns no dividend yield data, the answer must say "data not available" or "no dividend history found". Must NOT fabricate a dividend yield number.',
      expectedAnswer:
        'The answer must either: (1) say dividend yield data is unavailable, or (2) report the actual value from the tool. Must NOT make up a dividend yield number.',
    },
    tags: ['gold', 'grounded', 'no-hallucination'],
    source: 'hand-authored',
  },
];

// ── Dataset export ──────────────────────────────────────────────────────────

export const goldCaseDataset: EvaluationDataset = {
  id: 'folio-gold-cases',
  version: '1.0.0',
  name: 'Folio Gold Case Test Set',
  description:
    'Precise factual correctness test cases for CI smoke gates. Each case has a clear right answer that can be checked deterministically. Covers: quote accuracy, tool selection correctness, historical vs current data, groundedness, symbol normalization, portfolio context, and no-hallucination.',
  createdAt: Date.UTC(2026, 9, 11),
  cases: goldCases,
};
