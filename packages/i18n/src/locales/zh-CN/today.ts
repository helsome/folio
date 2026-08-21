import type { SameKeysAs } from '../keys.ts';
import type { today as enToday } from '../en-US/today.ts';

/** Today dashboard — Simplified Chinese (glossary-aligned §25, §31–32). */
export const today = {
  // hero
  quietWorkspace: '安静工作区',
  greeting: '早上好',
  heroSubtitle: '今天想了解关于你投资组合的什么？',
  searchPlaceholder: '搜索证券，例如 NVDA.US',
  searchAria: '搜索证券',
  quickActionDeepResearch: '深度研究',
  quickActionDeepResearchHint: '基于依据的报告',
  quickActionReviewPortfolio: '复核投资组合',
  quickActionReviewPortfolioHint: '查看风险与需要关注',
  quickActionCompareStocks: '对比个股',
  quickActionCompareStocksHint: '对齐决策',
  // sections
  portfolio: '投资组合',
  watchlistMovers: '自选涨跌幅',
  triggeredAlerts: '已触发提醒',
  upcomingEvents: '即将发生的事件',
  recentResearch: '最近研究',
  thesesNeedingReview: '待复核的投资逻辑',
  automation: '自动化',
  // generic section-state fallbacks (TodaySection)
  sectionLoading: '加载中…',
  sectionError: '出错了。',
  sectionEmpty: '这里还没有内容。',
  // portfolio states
  connectPortfolio: '连接 Longbridge 以查看你的投资组合。',
  noPortfolioData: '暂无投资组合数据。',
  // movers
  addSymbolsForMovers: '添加标的到自选以查看涨跌幅。',
  noMovers: '暂无涨跌幅。',
  noColumnMovers: '暂无变动',
  // alerts
  noTriggeredAlerts: '暂无已触发的提醒。',
  // events
  eventsUnavailable: '即将发生的事件暂不可用（日历通道尚未接通）。',
  // research
  noResearchReports: '暂无研究报告。',
  // theses
  allThesesUpToDate: '所有投资逻辑都是最新的。',
  // daily brief
  dailyBrief: '每日简报',
  dailyBriefUnavailable: '每日简报暂不可用。',
  nothingToReport: '暂无内容可汇报。',
  dailyBriefAttention: '需要关注',
  dailyBriefCount: '工作区发现 {{count}} 条事项',
  dailyBriefUpdated: '刚刚更新',
  dailyBriefQuietLabel: '保持安静',
  portfolioExposureDetail: '组合占比 {{percent}}%',
  portfolioExposureNote: '组合敞口 {{percent}}%',
  manage: '管理',
  hide: '收起',
  whySeeingThis: '我为什么看到这个？',
  // relative-time tokens (formatWhen)
  justNow: '刚刚',
  minutesAgo: '{{count}} 分钟前',
  hoursAgo: '{{count}} 小时前',
  // market pulse (MarketPulse card, spec §51–52)
  marketPulse: '市场脉搏',
  indexQuotesUnavailable: '指数行情不可用',
  marketStatusUnavailable: '市场状态不可用',
  marketTemperatureUnavailable: '市场温度不可用',
  topGainers: '涨幅居前',
  topLosers: '跌幅居前',
  whatMattersToMe: '与我相关',
  noWatchlistMovers: '自选中暂无变动',
  someDataUnavailable: '部分行情数据不可用',
  watchlistWeightShare: '自选权重占比',
  portfolioExposure: '组合敞口',
  impact: {
    positive: '利好',
    negative: '利空',
    neutral: '中性',
  },
  // daily brief source badges (keyed by BriefItemSource)
  source: {
    Portfolio: '投资组合',
    Watchlist: '自选',
    Thesis: '投资逻辑',
    Alert: '提醒',
    Automation: '自动化',
  },
  continueResearch: '继续',
  continueLabel: '今日',
} satisfies SameKeysAs<typeof enToday>;
