import { atom } from 'jotai';
import type { AlertRule, AlertRuleType, AlertTriggerEvent } from '@finagent/core';
import type { FinagentClient } from '../client';
import { loadAlertEvents, loadAlertRules, saveAlertRules } from '../client/alerts';

/**
 * Alert view state over the v2 `AlertRule` union. Rules and recent trigger
 * events are loaded/saved through a defensive client loader; when the IPC
 * channel is missing the state degrades to empty (never throws).
 */

export interface AlertState {
  rules: AlertRule[];
  events: AlertTriggerEvent[];
  loading: boolean;
  error: string | null;
}

export const alertStateAtom = atom<AlertState>({
  rules: [],
  events: [],
  loading: false,
  error: null,
});

/** Field-level input for a new/edited rule (before id/createdAt exist). */
export interface AlertRuleDraft {
  type: AlertRuleType;
  symbol?: string;
  targetPrice?: number;
  horizonDays?: number;
  minWeight?: number;
  maxWeight?: number;
  threshold?: number;
  enabled?: boolean;
  cooldownMinutes?: number;
}

export const DEFAULT_COOLDOWN_MINUTES = 30;

/** Human-readable labels for each rule type. */
export const ALERT_TYPE_LABELS: Record<AlertRuleType, string> = {
  price_above: 'Price Above',
  price_below: 'Price Below',
  new_news: 'News',
  earnings: 'Earnings',
  rating_change: 'Rating Change',
  dividend: 'Dividend',
  position_weight: 'Position Weight',
  portfolio_drawdown: 'Drawdown',
};

/**
 * Build a complete `AlertRule` from a draft. Pure — unit-tested directly.
 * `portfolio_drawdown` carries no symbol; price rules require `targetPrice`;
 * earnings default `horizonDays` to 14.
 */
export function buildAlertRule(
  draft: AlertRuleDraft,
  id: string = crypto.randomUUID(),
  createdAt: number = Date.now()
): AlertRule {
  const baseFields = {
    id,
    createdAt,
    enabled: draft.enabled ?? true,
    cooldownMinutes: draft.cooldownMinutes ?? DEFAULT_COOLDOWN_MINUTES,
  };

  switch (draft.type) {
    case 'price_above':
    case 'price_below':
      return { ...baseFields, symbol: draft.symbol ?? '', type: draft.type, targetPrice: draft.targetPrice ?? 0 };
    case 'new_news':
    case 'rating_change':
    case 'dividend':
      return { ...baseFields, symbol: draft.symbol ?? '', type: draft.type };
    case 'earnings':
      return { ...baseFields, symbol: draft.symbol ?? '', type: draft.type, horizonDays: draft.horizonDays ?? 14 };
    case 'position_weight':
      return {
        ...baseFields,
        symbol: draft.symbol ?? '',
        type: draft.type,
        ...(draft.minWeight !== undefined ? { minWeight: draft.minWeight } : {}),
        ...(draft.maxWeight !== undefined ? { maxWeight: draft.maxWeight } : {}),
      };
    case 'portfolio_drawdown':
      return { ...baseFields, type: draft.type, threshold: draft.threshold ?? 0 };
  }
}

/** Short per-type summary for list rendering (pure — unit-tested). */
export function ruleSummary(rule: AlertRule): string {
  switch (rule.type) {
    case 'price_above':
      return `Above $${rule.targetPrice.toFixed(2)}`;
    case 'price_below':
      return `Below $${rule.targetPrice.toFixed(2)}`;
    case 'new_news':
      return 'New headlines';
    case 'earnings':
      return `Earnings within ${rule.horizonDays} days`;
    case 'rating_change':
      return 'Rating change';
    case 'dividend':
      return 'Ex-dividend within 7 days';
    case 'position_weight': {
      const min = rule.minWeight !== undefined ? `${(rule.minWeight * 100).toFixed(0)}%` : '0%';
      const max = rule.maxWeight !== undefined ? `${(rule.maxWeight * 100).toFixed(0)}%` : '∞';
      return `Weight outside [${min}, ${max}]`;
    }
    case 'portfolio_drawdown':
      return `Drawdown > ${(rule.threshold * 100).toFixed(0)}%`;
  }
}

/** Load rules + recent events from the (defensive) client channel. */
export const loadAlertsAtom = atom(null, async (_get, set, client: FinagentClient) => {
  set(alertStateAtom, (state) => ({ ...state, loading: true, error: null }));
  try {
    const rules = await loadAlertRules(client);
    const events = await loadAlertEvents(client);
    set(alertStateAtom, { rules, events, loading: false, error: null });
  } catch (error) {
    set(alertStateAtom, (state) => ({
      ...state,
      loading: false,
      error: error instanceof Error ? error.message : 'Failed to load alerts',
    }));
  }
});

export const addAlertAtom = atom(
  null,
  async (get, set, input: { client: FinagentClient; rule: AlertRule }) => {
    const rules = [...get(alertStateAtom).rules, input.rule];
    set(alertStateAtom, (state) => ({ ...state, rules }));
    await saveAlertRules(input.client, rules);
  }
);

export const removeAlertAtom = atom(
  null,
  async (get, set, input: { client: FinagentClient; ruleId: string }) => {
    const rules = get(alertStateAtom).rules.filter((rule) => rule.id !== input.ruleId);
    set(alertStateAtom, (state) => ({ ...state, rules }));
    await saveAlertRules(input.client, rules);
  }
);

export const toggleAlertAtom = atom(
  null,
  async (get, set, input: { client: FinagentClient; ruleId: string }) => {
    const rules = get(alertStateAtom).rules.map((rule) =>
      rule.id === input.ruleId ? { ...rule, enabled: !rule.enabled } : rule
    );
    set(alertStateAtom, (state) => ({ ...state, rules }));
    await saveAlertRules(input.client, rules);
  }
);
