/**
 * Alert domain v2 — a discriminated-union rule model replacing the flat
 * `Alert { type; value }` shape. Every rule type carries exactly the fields
 * its evaluation needs; the scheduler, evaluators, and UI all operate on
 * this union.
 */

export interface AlertRuleBase {
  id: string;
  createdAt: number;
  enabled: boolean;
  /** Epoch ms of the last successful evaluation — dedup cursor for news/event rules. */
  lastCheckedAt?: number;
  /** Epoch ms of the last trigger. */
  lastTriggeredAt?: number;
  /** Minimum minutes between two triggers of the same rule. */
  cooldownMinutes: number;
}

export interface SymbolAlertRuleBase extends AlertRuleBase {
  symbol: string;
}

export type AlertRule =
  | (SymbolAlertRuleBase & { type: 'price_above'; targetPrice: number })
  | (SymbolAlertRuleBase & { type: 'price_below'; targetPrice: number })
  /** News items newer than the last check (or lastTriggeredAt) for the symbol. */
  | (SymbolAlertRuleBase & { type: 'new_news' })
  /** Upcoming earnings within horizonDays. */
  | (SymbolAlertRuleBase & { type: 'earnings'; horizonDays: number })
  | (SymbolAlertRuleBase & { type: 'rating_change' })
  | (SymbolAlertRuleBase & { type: 'dividend' })
  /** Position weight leaves [minWeight, maxWeight] (fractions of portfolio value). */
  | (SymbolAlertRuleBase & { type: 'position_weight'; minWeight?: number; maxWeight?: number })
  /** Portfolio drawdown from peak exceeds threshold (fraction). */
  | (AlertRuleBase & { type: 'portfolio_drawdown'; threshold: number });

export type AlertRuleType = AlertRule['type'];

export const ALERT_RULE_TYPES: AlertRuleType[] = [
  'price_above',
  'price_below',
  'new_news',
  'earnings',
  'rating_change',
  'dividend',
  'position_weight',
  'portfolio_drawdown',
];

/** An event emitted by the Alert Engine when a rule evaluates to triggered. */
export interface AlertTriggerEvent {
  id: string;
  ruleId: string;
  ruleType: AlertRuleType;
  symbol?: string;
  triggeredAt: number;
  /** Notification title, e.g. "NVDA rating downgrade". */
  title: string;
  /** Notification body, e.g. "Consensus rating moved from Buy to Hold." */
  message: string;
  /** Structured trigger payload for agent analysis. */
  payload?: Record<string, unknown>;
  /** Filled in by the main process when a thesis exists for the rule's symbol. */
  relatedThesisId?: string;
}
