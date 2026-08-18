import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAtom, useSetAtom } from 'jotai';
import { LOCALE_LABELS, type LocalePreference } from '@finagent/i18n';
import { acceptDisclaimersAtom, disclaimersAcceptedAtom } from '../../atoms';
import { DISCLAIMERS } from './disclaimers';
import { useI18n } from '../../i18n/I18nProvider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

const DISCLAIMER_KEYS: Record<string, { titleKey: string; bodyKey: string }> = {
  privacy: {
    titleKey: 'onboarding.welcome.disclaimerPrivacyTitle',
    bodyKey: 'onboarding.welcome.disclaimerPrivacyBody',
  },
  'ai-analysis': {
    titleKey: 'onboarding.welcome.disclaimerAiTitle',
    bodyKey: 'onboarding.welcome.disclaimerAiBody',
  },
  'financial-information': {
    titleKey: 'onboarding.welcome.disclaimerFinancialTitle',
    bodyKey: 'onboarding.welcome.disclaimerFinancialBody',
  },
};

/**
 * Welcome + one-time disclaimers (spec §42). Also exposes a language switch so
 * users can pick a locale before finishing onboarding (spec §71–72); the
 * preference persists and re-renders the whole flow immediately.
 */
export const WelcomeStep: React.FC = () => {
  const { t } = useTranslation();
  const { preference, changeLanguage } = useI18n();
  const [accepted] = useAtom(disclaimersAcceptedAtom);
  const accept = useSetAtom(acceptDisclaimersAtom);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h2 className="text-[18px] font-semibold text-foreground">{t('onboarding.welcome.title')}</h2>
          <p className="text-[13px] text-foreground/66">{t('onboarding.welcome.subtitle')}</p>
        </div>
        <div className="w-32 shrink-0">
          <Select
            value={preference}
            onValueChange={(value) => void changeLanguage(value as LocalePreference)}
          >
            <SelectTrigger aria-label={t('onboarding.language')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">{t('settings.languageSystem')}</SelectItem>
              <SelectItem value="zh-CN">{LOCALE_LABELS['zh-CN']}</SelectItem>
              <SelectItem value="en-US">{LOCALE_LABELS['en-US']}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        {DISCLAIMERS.map((disclaimer) => {
          const keys = DISCLAIMER_KEYS[disclaimer.id];
          return (
            <div key={disclaimer.id} className="rounded-[10px] border mac-section-divider p-3">
              <div className="text-[12px] font-semibold text-foreground">{t(keys.titleKey)}</div>
              <p className="mt-1 text-[12px] leading-relaxed text-foreground/60">{t(keys.bodyKey)}</p>
            </div>
          );
        })}
      </div>

      <label className="flex items-center gap-2 rounded-[10px] border mac-section-divider p-3">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(event) => {
            if (event.target.checked) accept();
          }}
          className="accent-[var(--mac-blue)]"
          data-testid="disclaimer-accept"
        />
        <span className="text-[12px] text-foreground/72">{t('onboarding.welcome.accept')}</span>
      </label>
    </div>
  );
};
