/** Discover — task-driven screening (spec §5–10, §26). */
export const discover = {
  title: 'Discover',
  subtitle:
    'Pick a task to screen {{scope}} — deterministic rules over live market data, no AI scanning.',
  scopeWatchlist: 'your watchlist ({{count}} symbols)',
  scopeUniverse: 'the built-in universe',
  notAvailable: 'Screening is not available yet — the screening channel is not wired.',
  reloadFailed: 'Could not reload that run.',
  resultsAria: 'Screening results',
  candidates: '{{count}} candidate',
  candidates_other: '{{count}} candidates',
  dataSourcesUnavailable: 'Data sources unavailable this run: {{list}}',
  noCandidates: 'No candidates matched this task in the current universe.',
  candidate: 'Candidate',
  metrics: 'Metrics',
  actions: 'Actions',
  score: 'Score',
  previousRuns: 'Previous runs',
  previousRunsAria: 'Previous runs',
  noRuns: 'No screening runs yet.',
  reopen: 'Reopen',
  run: 'Run',
  running: 'Running…',
  research: 'Research',
  compare: 'Compare',
  watch: 'Watch',
  added: 'Added',
  // screening strategy display names + descriptions — keyed by the STABLE
  // strategy id (ids themselves are domain identifiers, §11).
  strategy: {
    'top-gainers': {
      title: 'Top Gainers',
      description: 'Biggest single-day price gains in the universe.',
    },
    'top-losers': {
      title: 'Top Losers',
      description: 'Biggest single-day price declines in the universe.',
    },
    'high-volume': {
      title: 'High Volume',
      description: 'Unusual trading volume versus each stock’s recent baseline.',
    },
    'unusual-movement': {
      title: 'Unusual Movement',
      description: 'Price amplitude well beyond each stock’s recent range.',
    },
    'low-valuation': {
      title: 'Low Valuation',
      description: 'Cheap on price-to-earnings and/or price-to-book.',
    },
    'high-roe': {
      title: 'High ROE',
      description: 'Efficient capital use — return on equity above the bar.',
    },
    'revenue-growth': {
      title: 'Revenue Growth',
      description: 'Top-line growth — latest reported YoY revenue increase.',
    },
    'high-dividend': {
      title: 'High Dividend',
      description: 'Attractive dividend yield with a real payment history.',
    },
    'quality-growth': {
      title: 'Quality Growth',
      description: 'Growth that is profitable — ROE, margin and revenue together.',
    },
    'strong-momentum': {
      title: 'Strong Momentum',
      description: 'Sustained upside — strong 1m and 3m returns.',
    },
    breakout: {
      title: 'Breakout',
      description: 'New highs on expanding volume.',
    },
    oversold: {
      title: 'Oversold',
      description: 'Deep pullback — price well below its short-term average.',
    },
    'trend-reversal': {
      title: 'Trend Reversal',
      description: 'Downtrend showing its first sign of turning up.',
    },
    'upcoming-earnings': {
      title: 'Upcoming Earnings',
      description: 'Earnings announcements inside the next 30 days.',
    },
    'rating-changes': {
      title: 'Rating Changes',
      description: 'Buy-consensus names with meaningful analyst upside.',
    },
    'news-surge': {
      title: 'News Surge',
      description: 'A burst of recent headlines — a stock in the news.',
    },
    'dividend-events': {
      title: 'Dividend Events',
      description: 'Ex-dividend dates arriving within the next 90 days.',
    },
  },
  // strategy families (group headers) — keyed by stable family id §11.
  family: {
    'market-movers': 'Market Movers',
    fundamental: 'Fundamental',
    technical: 'Technical',
    events: 'Events',
  },
} satisfies Record<string, string | Record<string, string | Record<string, string>>>;
