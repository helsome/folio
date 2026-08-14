export { createOpinion, extractEntryPrice, OPINION_DEFAULT_HORIZON, type CreateOpinionOptions } from './opinions.ts'
export {
  HORIZON_MS,
  NEUTRAL_BOUND_PCT,
  OutcomeEngine,
  directionCorrectFor,
  expectationFor,
  horizonEndMs,
  maxDrawdownPct,
  type EvaluateOptions,
  type OutcomeUnableReason,
} from './engine.ts'
export { OutcomeRepository } from './repository.ts'
export { OutcomeService, type HistoryFetcher, type OutcomeServiceOptions } from './service.ts'
