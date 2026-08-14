export {
  buildDiff,
  diffIdFor,
  thesisImpactFromDiff,
  type BuildDiffOptions,
  type ThesisImpactDirection,
  type ThesisImpactResult,
} from './diff-service.ts'
export {
  CONFIDENCE_LABEL,
  isMaterial,
  isVerdictFlip,
  MATERIAL_CONFIDENCE_DELTA,
  MATERIAL_PRICE_MOVE_PCT,
  PRICE_LABEL,
  RATING_LABEL,
  VERDICT_CHANGE_LABEL,
} from './materiality.ts'
export { ResearchDiffRepository } from './repository.ts'
