import React from 'react';
import { useAtom } from 'jotai';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { LOCALE_LABELS, type LocalePreference } from '@finagent/i18n';
import { llmStateAtom } from '../../atoms';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { useTheme, type ThemeMode } from '../layout/ThemeProvider';
import { useI18n } from '../../i18n/I18nProvider';

/** Minimal, real app + agent-runtime information. */
export const GeneralTab: React.FC = () => {
  const [state] = useAtom(llmStateAtom);
  const { mode, setMode } = useTheme();
  const { t } = useTranslation();
  const { preference, changeLanguage } = useI18n();
  const model = state.model;

  const rows: Array<{ label: string; value: string }> = [
    { label: t('settings.rows.application'), value: 'Folio' },
    { label: t('settings.rows.agentRuntime'), value: state.runtimeProvider },
    { label: t('settings.rows.streaming'), value: state.isStreaming ? t('settings.enabled') : t('settings.disabled') },
    { label: t('settings.rows.activeModel'), value: model ? (model.name || `${model.provider}/${model.id}`) : '—' },
    { label: t('settings.rows.thinkingLevel'), value: state.thinkingLevel },
  ];

  const changeLanguagePreference = async (next: LocalePreference) => {
    await changeLanguage(next);
    toast.success(
      next === 'system'
        ? t('settings.languageChanged')
        : `${t('settings.languageChanged')} (${LOCALE_LABELS[next]})`,
      { description: t('settings.languageSystem') }
    );
  };

  return (
    <div className="max-w-2xl">
      <div className="space-y-4">
      <div className="mac-stock-tile rounded-[12px] p-5">
        <h2 className="mb-4 text-[14px] font-semibold text-foreground">{t('settings.sections.application')}</h2>
        <dl className="space-y-3">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-4">
              <dt className="text-[13px] text-foreground/54">{row.label}</dt>
              <dd className="text-right text-[13px] font-medium text-foreground">{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="mac-stock-tile rounded-[12px] p-5">
        <div className="flex items-center justify-between gap-4">
          <div><h2 className="text-[14px] font-semibold text-foreground">{t('settings.language')}</h2><p className="mt-1 text-[12px] text-foreground/48">{t('settings.languageDescription')}</p></div>
          <div className="w-36">
            <Select value={preference} onValueChange={(value) => void changeLanguagePreference(value as LocalePreference)}>
              <SelectTrigger aria-label={t('settings.language')}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="system">{t('settings.languageSystem')}</SelectItem>
                <SelectItem value="zh-CN">{LOCALE_LABELS['zh-CN']}</SelectItem>
                <SelectItem value="en-US">{LOCALE_LABELS['en-US']}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
      <div className="mac-stock-tile rounded-[12px] p-5">
        <div className="flex items-center justify-between gap-4">
          <div><h2 className="text-[14px] font-semibold text-foreground">{t('settings.theme')}</h2><p className="mt-1 text-[12px] text-foreground/48">{t('settings.themeDescription')}</p></div>
          <div className="w-36"><Select value={mode} onValueChange={(value) => setMode(value as ThemeMode)}><SelectTrigger aria-label={t('settings.theme')}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="light">{t('settings.themeLight')}</SelectItem><SelectItem value="dark">{t('settings.themeDark')}</SelectItem><SelectItem value="system">{t('settings.themeSystem')}</SelectItem></SelectContent></Select></div>
        </div>
      </div>
      </div>
    </div>
  );
};
