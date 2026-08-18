import type { NamespaceResource } from '../keys.ts';

/** Automation slice (spec §21–25, §33, §47–48, §80). */
export const automation = {
  loading: 'Loading…',
  noRules: 'No automation rules yet. The five default rules are seeded by the app on first run.',
  footer:
    'Automations run after market close (16:30 local, weekdays) and on earnings events. Only material changes trigger deep research.',
  type: {
    watchlistDailyReview: 'Watchlist daily review',
    portfolioDailyBrief: 'Portfolio daily brief',
    weeklyThesisReview: 'Weekly thesis review',
    preEarningsResearch: 'Pre-earnings research',
    postEarningsResearch: 'Post-earnings research',
  },
  notify: {
    materialOnly: 'Material only',
    allChanges: 'All changes',
  },
  run: {
    runNow: 'Run now',
    running: 'Running…',
    noRunsYet: 'No runs yet',
    lastRun: 'Last run {{when}} · {{evaluated}} evaluated, {{material}} material',
  },
  schedule: {
    daily: 'Daily',
    weekdays: 'Weekdays',
    sundays: 'Sundays {{time}}',
    onEarningsEvents: 'On earnings events',
    justNow: 'just now',
    minutesAgo: '{{count}}m ago',
    hoursAgo: '{{count}}h ago',
  },
  status: {
    active: 'Active',
    triggered: 'Triggered',
    paused: 'Paused',
    error: 'Error',
  },
  enabled: 'enabled',
  disabled: 'disabled',
  notification: {
    triggeredTitle: '{{type}} triggered',
    materialBody: 'Material changes detected. Open Folio to review the latest research.',
    allBody: 'Automated research completed. Open Folio to review the latest results.',
    materialTitle: '{{symbol}} needs your attention',
    noMaterialTitle: '{{symbol}} reviewed',
    materialBodyDetail: '{{type}} detected a material change{{pct}}. Open Folio to review it.',
    noMaterialBodyDetail: 'No changes above the materiality bar ({{type}}).',
  },
} satisfies NamespaceResource;
