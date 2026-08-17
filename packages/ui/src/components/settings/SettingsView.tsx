import React from 'react';
import { useAtom } from 'jotai';
import type { SettingsTab } from '../../atoms';
import { settingsTabAtom } from '../../atoms';
import { GeneralTab } from './GeneralTab';
import { ModelsTab } from './ModelsTab';
import { ConnectionsCenter } from './ConnectionsCenter';
import { SkillsView } from './SkillsView';
import { DiagnosticsTab } from './DiagnosticsTab';
import { PerformanceView } from '../performance/PerformanceView';
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs';

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'llm', label: 'LLM' },
  { id: 'connections', label: 'Connections' },
  { id: 'skills', label: 'Skills' },
  { id: 'diagnostics', label: 'Diagnostics' },
  // Performance tab (V5 spec §36–38) — aggregates opinion outcomes.
  { id: 'performance', label: 'Performance' },
];

export const SettingsView: React.FC = () => {
  const [tab, setTab] = useAtom(settingsTabAtom);

  return (
    <main className="mac-main-surface flex h-full flex-1 flex-col">
      <header className="border-b mac-section-divider px-6 pt-5">
        <div className="flex items-start justify-between gap-4">
          <div><p className="text-[10px] font-semibold uppercase tracking-[.14em] text-foreground/38">Preferences</p><h1 className="mt-1 text-[20px] font-semibold tracking-tight text-foreground">Settings</h1></div>
          <p className="max-w-xs text-right text-[11px] leading-relaxed text-foreground/42">Configure Folio without leaving your finance workspace.</p>
        </div>
        <Tabs value={tab} onValueChange={(value) => setTab(value as SettingsTab)} className="mt-3">
          <TabsList>
            {TABS.map((t) => <TabsTrigger key={t.id} value={t.id}>{t.label}</TabsTrigger>)}
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
      </div>
    </main>
  );
};
