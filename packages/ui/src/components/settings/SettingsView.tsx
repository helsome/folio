import React from 'react';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import type { SettingsTab } from '../../atoms';
import { settingsTabAtom } from '../../atoms';
import { GeneralTab } from './GeneralTab';
import { ModelsTab } from './ModelsTab';
import { ConnectionsCenter } from './ConnectionsCenter';
import { SkillsView } from './SkillsView';
import { DiagnosticsTab } from './DiagnosticsTab';
import { EvaluationSettingsTab } from './EvaluationSettingsTab';
import { PerformanceView } from '../performance/PerformanceView';
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs';

const TABS: Array<{ id: SettingsTab; labelKey: string }> = [
  { id: 'general', labelKey: 'settings.tabs.general' },
  { id: 'llm', labelKey: 'settings.tabs.llm' },
  { id: 'connections', labelKey: 'settings.tabs.connections' },
  { id: 'skills', labelKey: 'settings.tabs.skills' },
  { id: 'diagnostics', labelKey: 'settings.tabs.diagnostics' },
  // Performance tab (V5 spec §36–38) — aggregates opinion outcomes.
  { id: 'performance', labelKey: 'settings.tabs.performance' },
  // Agent evaluation (V7 spec §61–63) — LangSmith connection + tracing.
  { id: 'evaluation', labelKey: 'settings.tabs.evaluation' },
];

export const SettingsView: React.FC = () => {
  const { t } = useTranslation();
  const [tab, setTab] = useAtom(settingsTabAtom);

  return (
    <main className="mac-main-surface flex h-full flex-1 flex-col">
      <header className="border-b mac-section-divider px-6 pt-5">
        <div className="flex items-start justify-between gap-4">
          <div><p className="text-[10px] font-semibold uppercase tracking-[.14em] text-foreground/38">{t('settings.preferences')}</p><h1 className="mt-1 text-[20px] font-semibold tracking-tight text-foreground">{t('settings.title')}</h1></div>
          <p className="max-w-xs text-right text-[11px] leading-relaxed text-foreground/42">{t('settings.subtitle')}</p>
        </div>
        <Tabs value={tab} onValueChange={(value) => setTab(value as SettingsTab)} className="mt-3">
          <TabsList>
            {TABS.map((tabDef) => <TabsTrigger key={tabDef.id} value={tabDef.id}>{t(tabDef.labelKey)}</TabsTrigger>)}
          </TabsList>
        </Tabs>
      </header>
      <div className="flex-1 overflow-y-auto p-6">
        {tab === 'general' && <GeneralTab />}
        {tab === 'llm' && <ModelsTab />}
        {tab === 'connections' && <ConnectionsCenter />}
        {tab === 'skills' && <SkillsView />}
        {tab === 'diagnostics' && <DiagnosticsTab />}
        {tab === ('performance') && <PerformanceView />}
        {tab === 'evaluation' && <EvaluationSettingsTab />}
      </div>
    </main>
  );
};
