import type { AutomationRule, AutomationType } from '@finagent/core';
import { createSyncI18n, type SupportedLocale } from '@finagent/i18n';

/**
 * Bilingual automation notification copy (spec §47, §80). Pure helper —
 * returns {title, body} resolved through @finagent/i18n for a locale.
 * Intent: wired into notification senders (kernelHost integration later), not
 * the renderer. Domain identifiers (type ids) are never translated.
 */

type AutomationTypeKey = Record<AutomationType, string>;

/** Stable automation-type id → i18n key (ids never translated, §11). */
export const AUTOMATION_TYPE_KEYS: AutomationTypeKey = {
  'watchlist-daily-review': 'automation.type.watchlistDailyReview',
  'portfolio-daily-brief': 'automation.type.portfolioDailyBrief',
  'weekly-thesis-review': 'automation.type.weeklyThesisReview',
  'pre-earnings-research': 'automation.type.preEarningsResearch',
  'post-earnings-research': 'automation.type.postEarningsResearch',
};

export interface AutomationNotification {
  title: string;
  body: string;
}

export function formatAutomationNotification(
  rule: AutomationRule,
  locale: SupportedLocale = 'en-US'
): AutomationNotification {
  const i18n = createSyncI18n({ locale });
  const t = i18n.t.bind(i18n);
  const typeLabel = t(AUTOMATION_TYPE_KEYS[rule.type]);
  const title = t('automation.notification.triggeredTitle', { type: typeLabel });
  const body =
    rule.notify === 'material-only'
      ? t('automation.notification.materialBody')
      : t('automation.notification.allBody');
  return { title, body };
}
