import type { PerformanceHorizon, SkillPerformance, StrategyPerformance } from '@finagent/core'
import type { OutcomeRepository } from '../outcome/repository.ts'
import { aggregateSkillPerformance, aggregateStrategyPerformance } from './aggregate.ts'

/**
 * Performance aggregation service (spec §36–38).
 *
 * Read-only consumer of the OutcomeRepository: reads every opinion + outcome
 * and aggregates per horizon. It never writes — evaluation is the
 * OutcomeEngine's job; this service only measures what was already recorded.
 */

export class PerformanceService {
  private readonly repository: OutcomeRepository

  constructor(repository: OutcomeRepository) {
    this.repository = repository
  }

  /** Per-skill performance for one horizon, best-samples first. */
  async skillPerformance(horizon: PerformanceHorizon): Promise<SkillPerformance[]> {
    const [opinions, outcomes] = await Promise.all([
      this.repository.listOpinions(),
      this.repository.listOutcomes(),
    ])
    return aggregateSkillPerformance(opinions, outcomes, horizon)
  }

  /** Per-strategy performance for one horizon, best-samples first. */
  async strategyPerformance(horizon: PerformanceHorizon): Promise<StrategyPerformance[]> {
    const [opinions, outcomes] = await Promise.all([
      this.repository.listOpinions(),
      this.repository.listOutcomes(),
    ])
    return aggregateStrategyPerformance(opinions, outcomes, horizon)
  }
}
