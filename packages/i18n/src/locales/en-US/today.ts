/** Today dashboard (spec §25, §31–32). */
export const today = {
  // hero
  quietWorkspace: 'Quiet workspace',
  greeting: 'Good morning',
  heroSubtitle: 'What do you want to understand about your portfolio today?',
  searchPlaceholder: 'Search a security, e.g. NVDA.US',
  searchAria: 'Search a security',
  quickActionDeepResearch: 'Deep Research',
  quickActionDeepResearchHint: 'Evidence-backed report',
  quickActionReviewPortfolio: 'Review Portfolio',
  quickActionReviewPortfolioHint: 'See risk and attention',
  quickActionCompareStocks: 'Compare Stocks',
  quickActionCompareStocksHint: 'Line up a decision',
  // sections
  portfolio: 'Portfolio',
  watchlistMovers: 'Watchlist movers',
  triggeredAlerts: 'Triggered alerts',
  upcomingEvents: 'Upcoming events',
  recentResearch: 'Recent research',
  thesesNeedingReview: 'Theses needing review',
  automation: 'Automation',
  // generic section-state fallbacks (TodaySection)
  sectionLoading: 'Loading…',
  sectionError: 'Something went wrong.',
  sectionEmpty: 'Nothing here yet.',
  // portfolio states
  connectPortfolio: 'Connect Longbridge to see your portfolio.',
  noPortfolioData: 'No portfolio data yet.',
  // movers
  addSymbolsForMovers: 'Add symbols to your watchlist to see movers.',
  noMovers: 'No movers yet.',
  noColumnMovers: 'No movers',
  // alerts
  noTriggeredAlerts: 'No triggered alerts.',
  // events
  eventsUnavailable: 'Upcoming events are not available yet (calendar channel not wired).',
  // research
  noResearchReports: 'No research reports yet.',
  // theses
  allThesesUpToDate: 'All theses are up to date.',
  // daily brief
  dailyBrief: 'Daily Brief',
  dailyBriefUnavailable: 'Daily Brief is not available yet.',
  nothingToReport: 'Nothing to report.',
  manage: 'Manage',
  hide: 'Hide',
  whySeeingThis: 'Why am I seeing this?',
  // relative-time tokens (formatWhen)
  justNow: 'just now',
  minutesAgo: '{{count}}m ago',
  hoursAgo: '{{count}}h ago',
  // market pulse (MarketPulse card, spec §51–52)
  marketPulse: 'Market Pulse',
  indexQuotesUnavailable: 'Index quotes unavailable',
  marketStatusUnavailable: 'Market status unavailable',
  marketTemperatureUnavailable: 'Market temperature unavailable',
  topGainers: 'Top gainers',
  topLosers: 'Top losers',
  whatMattersToMe: 'What matters to me',
  noWatchlistMovers: 'No movers in your watchlist',
  someDataUnavailable: 'Some market data unavailable',
  watchlistWeightShare: 'Watchlist weight share',
  portfolioExposure: 'Portfolio exposure',
  impact: {
    positive: 'Positive',
    negative: 'Negative',
    neutral: 'Neutral',
  },
  // daily brief source badges (keyed by BriefItemSource)
  source: {
    Portfolio: 'Portfolio',
    Watchlist: 'Watchlist',
    Thesis: 'Thesis',
    Alert: 'Alert',
    Automation: 'Automation',
  },
  continueResearch: 'Continue',
  continueLabel: 'Today',
} satisfies Record<string, string | Record<string, string>>;
