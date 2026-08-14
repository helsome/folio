export { AutomationRuleRepository, AutomationRunRepository } from './rules-repository.ts'
export {
  DEFAULT_BRIEF_HOUR,
  THESIS_REVIEW_DAY,
  THESIS_REVIEW_HOUR,
  WEEKDAYS,
  daysFor,
  isDueAt,
  isScheduledType,
  nextRunAt,
  occurrenceOn,
  runDue,
  scheduleFor,
} from './scheduler.ts'
export {
  runAutomation,
  signalsAreMaterial,
  type AutomationRunContext,
  type MaterialSignals,
} from './runner.ts'
export {
  buildBrief,
  type BriefInputs,
  type BriefItem,
  type BriefItemSource,
  type BriefPortfolioSummary,
  type BriefQuietState,
  type BriefSeverity,
  type BriefWatchlistMover,
  type DailyBrief,
} from './brief.ts'
