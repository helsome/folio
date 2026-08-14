import type {
  AlertRule,
  AlertTriggerEvent,
  CapabilityRegistry,
  MarketStatus,
} from '@finagent/core';
import { evaluateRule } from './evaluators.ts';
import {
  isAnyMarketOpen,
  isMarketOpen,
  marketForSymbol,
} from './evaluators.ts';
import type { AlertEvaluatorContext } from './evaluators.ts';
import { AlertRuleRepository } from './rules-repository.ts';
import { AlertEventLog } from './events.ts';

const MINUTE_MS = 60_000;

/** Rule types gated on market-hours. */
const MARKET_GATED_TYPES: ReadonlySet<AlertRule['type']> = new Set([
  'price_above',
  'price_below',
  'position_weight',
  'portfolio_drawdown',
]);

export interface AlertEngineOptions {
  registry: CapabilityRegistry;
  repository: AlertRuleRepository;
  eventLog: AlertEventLog;
  /** Injectable clock (ms). Defaults to Date.now. */
  now?: () => number;
  /** Called for every triggered event (Lead wires OS notifications + thesis hook). */
  onTrigger?: (event: AlertTriggerEvent) => void;
}

/**
 * Interval-driven alert engine. Each tick evaluates every enabled rule under a
 * per-rule try/catch (one bad rule never kills the tick) and honors:
 *
 * - cooldown: skip when `lastTriggeredAt + cooldownMinutes` has not elapsed;
 * - dedup: `lastCheckedAt` advances after every evaluation (news/event cursor);
 * - market-hours: price/weight/drawdown rules skip while the relevant market is
 *   closed, but evaluate anyway when `market.status` is unavailable.
 */
export class AlertEngine {
  private readonly registry: CapabilityRegistry;
  private readonly repository: AlertRuleRepository;
  private readonly eventLog: AlertEventLog;
  private readonly now: () => number;
  private readonly onTrigger: ((event: AlertTriggerEvent) => void) | undefined;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor(options: AlertEngineOptions) {
    this.registry = options.registry;
    this.repository = options.repository;
    this.eventLog = options.eventLog;
    this.now = options.now ?? Date.now;
    this.onTrigger = options.onTrigger;
  }

  start(intervalMs = 60_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Evaluate every enabled rule once. Exposed for direct (deterministic) tests. */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = this.now();
      const marketStatus = await this.loadMarketStatus();
      const rules = await this.repository.list();
      for (const rule of rules) {
        await this.evaluateOne(rule, now, marketStatus);
      }
    } finally {
      this.ticking = false;
    }
  }

  private get context(): AlertEvaluatorContext {
    return {
      now: this.now,
      getRuleSnapshot: (ruleId) => this.repository.getRuleSnapshot(ruleId),
      patchRuleSnapshot: (ruleId, patch) => this.repository.patchRuleSnapshot(ruleId, patch),
    };
  }

  private async loadMarketStatus(): Promise<MarketStatus[] | null> {
    const capability = this.registry.get('market.status');
    if (!capability) return null; // unavailable → degrade to always-on
    try {
      const result = await capability.execute({}, { now: this.now });
      return Array.isArray(result?.data) ? (result.data as MarketStatus[]) : null;
    } catch {
      return null;
    }
  }

  private async evaluateOne(
    rule: AlertRule,
    now: number,
    marketStatus: MarketStatus[] | null
  ): Promise<void> {
    try {
      if (!rule.enabled) return;

      // Cooldown: skip while the minimum interval since the last trigger has
      // not elapsed.
      if (
        rule.lastTriggeredAt !== undefined &&
        now - rule.lastTriggeredAt < rule.cooldownMinutes * MINUTE_MS
      ) {
        return;
      }

      // Market-hours: only evaluate gated types while the relevant market is
      // open; when market.status is unavailable (or empty) evaluate anyway.
      if (
        MARKET_GATED_TYPES.has(rule.type) &&
        marketStatus !== null &&
        marketStatus.length > 0 &&
        !isRelevantMarketOpen(rule, marketStatus)
      ) {
        return;
      }

      const event = await evaluateRule(rule, this.registry, this.context);

      if (event) {
        await this.repository.patchRule(rule.id, { lastCheckedAt: now, lastTriggeredAt: now });
        await this.eventLog.append(event);
        this.onTrigger?.(event);
      } else {
        await this.repository.patchRule(rule.id, { lastCheckedAt: now });
      }
    } catch (error) {
      console.warn(
        `[alerts] rule ${rule.id} failed during evaluation:`,
        error instanceof Error ? error.message : String(error)
      );
    }
  }
}

function isRelevantMarketOpen(rule: AlertRule, statuses: MarketStatus[]): boolean {
  if (rule.type === 'portfolio_drawdown') {
    // Portfolio-wide metric: evaluate when any exchange is trading.
    return isAnyMarketOpen(statuses);
  }
  const symbol = (rule as { symbol?: string }).symbol;
  if (!symbol) return isAnyMarketOpen(statuses);
  return isMarketOpen(statuses, marketForSymbol(symbol));
}
