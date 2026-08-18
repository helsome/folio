import type { SameKeysAs } from '../keys.ts';
import type { automation as enAutomation } from '../en-US/automation.ts';

/** Automation slice (spec §21–25, §33, §47–48, §80) — Simplified Chinese. */
export const automation = {
  loading: '加载中…',
  noRules: '尚无自动化规则。应用首次运行时会预置五条默认规则。',
  footer:
    '自动化在市场收盘后（工作日当地时间 16:30）以及财报事件时运行。仅重要变化会触发深度研究。',
  type: {
    watchlistDailyReview: '每日自选回顾',
    portfolioDailyBrief: '投资组合每日简报',
    weeklyThesisReview: '每周逻辑复核',
    preEarningsResearch: '财报前研究',
    postEarningsResearch: '财报后研究',
  },
  notify: {
    materialOnly: '仅重要变化',
    allChanges: '所有变化',
  },
  run: {
    runNow: '立即运行',
    running: '运行中…',
    noRunsYet: '尚无运行记录',
    lastRun: '上次运行 {{when}} · 评估 {{evaluated}} 项，其中 {{material}} 项重要变化',
  },
  schedule: {
    daily: '每日',
    weekdays: '工作日',
    sundays: '周日 {{time}}',
    onEarningsEvents: '财报事件时',
    justNow: '刚刚',
    minutesAgo: '{{count}} 分钟前',
    hoursAgo: '{{count}} 小时前',
  },
  status: {
    active: '生效中',
    triggered: '已触发',
    paused: '已暂停',
    error: '出错',
  },
  enabled: '已启用',
  disabled: '已禁用',
  notification: {
    triggeredTitle: '{{type}} 已触发',
    materialBody: '检测到重要变化。打开 Folio 查看最新研究。',
    allBody: '自动化研究已完成。打开 Folio 查看最新结果。',
    materialTitle: '{{symbol}} 需要关注',
    noMaterialTitle: '{{symbol}} 已完成复核',
    materialBodyDetail: '{{type}} 检测到重要变化{{pct}}。打开 Folio 查看。',
    noMaterialBodyDetail: '未发现高于重要阈值的变化({{type}})。',
  },
} satisfies SameKeysAs<typeof enAutomation>;
