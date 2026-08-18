import type { SameKeysAs } from '../keys.ts';
import type { discover as enDiscover } from '../en-US/discover.ts';

/** Discover — task-driven screening — Simplified Chinese (glossary-aligned §26). */
export const discover = {
  title: '机会发现',
  subtitle: '选择一个任务来筛选{{scope}}——基于实时市场数据的确定性规则，无 AI 扫描。',
  scopeWatchlist: '你的自选（{{count}} 个标的）',
  scopeUniverse: '内置证券池',
  notAvailable: '筛选暂不可用——筛选通道尚未接通。',
  reloadFailed: '无法重新加载该次运行。',
  resultsAria: '筛选结果',
  candidates: '{{count}} 个候选',
  candidates_other: '{{count}} 个候选',
  dataSourcesUnavailable: '本次运行数据源不可用：{{list}}',
  noCandidates: '当前证券池中没有匹配该任务的候选。',
  candidate: '候选',
  metrics: '指标',
  actions: '操作',
  score: '评分',
  previousRuns: '历史运行',
  previousRunsAria: '历史运行',
  noRuns: '暂无筛选运行。',
  reopen: '重新打开',
  run: '运行',
  running: '运行中…',
  research: '研究',
  compare: '对比',
  watch: '关注',
  added: '已添加',
  // screening strategy display names + descriptions — keyed by STABLE id (§11).
  strategy: {
    'top-gainers': {
      title: '涨幅居前',
      description: '证券池中单日涨幅最大的标的。',
    },
    'top-losers': {
      title: '跌幅居前',
      description: '证券池中单日跌幅最大的标的。',
    },
    'high-volume': {
      title: '高成交量',
      description: '成交量大异于该股近期基线的标的。',
    },
    'unusual-movement': {
      title: '异动',
      description: '价格振幅远超该股近期区间的标的。',
    },
    'low-valuation': {
      title: '低估值',
      description: '市盈率和/或市净率便宜的标的。',
    },
    'high-roe': {
      title: '高 ROE',
      description: '资本使用高效——净资产收益率高于阈值。',
    },
    'revenue-growth': {
      title: '营收增长',
      description: '顶层增长——最近一期报告的同比营收增长。',
    },
    'high-dividend': {
      title: '高股息',
      description: '有真实派息历史的具吸引力股息收益率。',
    },
    'quality-growth': {
      title: '优质成长',
      description: '盈利型增长——ROE、利润率与营收共同向好。',
    },
    'strong-momentum': {
      title: '强势动能',
      description: '持续上行——1 个月和 3 个月回报强劲。',
    },
    breakout: {
      title: '突破',
      description: '成交量放大并创出新高。',
    },
    oversold: {
      title: '超卖',
      description: '深度回调——价格远低于短期均线。',
    },
    'trend-reversal': {
      title: '趋势反转',
      description: '下行趋势出现首次反转迹象。',
    },
    'upcoming-earnings': {
      title: '即将发布的财报',
      description: '未来 30 天内的财报公告。',
    },
    'rating-changes': {
      title: '评级变动',
      description: '买入共识且分析师上行空间明显的标的。',
    },
    'news-surge': {
      title: '新闻热度',
      description: '近期头条爆发——处于新闻焦点的个股。',
    },
    'dividend-events': {
      title: '股息事件',
      description: '未来 90 天内到来的除息日。',
    },
  },
  family: {
    'market-movers': '市场异动',
    fundamental: '基本面',
    technical: '技术面',
    events: '事件',
  },
} satisfies SameKeysAs<typeof enDiscover>;
