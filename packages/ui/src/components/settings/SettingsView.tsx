import React, { useState } from 'react';
import { GeneralTab } from './GeneralTab';
import { ModelsTab } from './ModelsTab';
import { LongbridgeTab } from './LongbridgeTab';
import { SkillsView } from './SkillsView';

type SettingsTab = 'general' | 'models' | 'longbridge' | 'skills';

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'models', label: 'Models' },
  { id: 'longbridge', label: 'Longbridge' },
  { id: 'skills', label: 'Skills' },
];

export const SettingsView: React.FC = () => {
  const [tab, setTab] = useState<SettingsTab>('general');

  return (
    <main className="mac-main-surface flex h-full flex-1 flex-col">
      <header className="border-b mac-section-divider px-6 pt-5">
        <h1 className="text-[20px] font-semibold tracking-tight text-foreground">Settings</h1>
        <nav className="mt-3 flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`rounded-t-[10px] border-b-2 px-4 py-2 text-[13px] font-medium transition-smooth ${
                tab === t.id
                  ? 'border-accent text-foreground'
                  : 'border-transparent text-foreground/52 hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      <div className="flex-1 overflow-y-auto p-6">
        {tab === 'general' && <GeneralTab />}
        {tab === 'models' && <ModelsTab />}
        {tab === 'longbridge' && <LongbridgeTab />}
        {tab === 'skills' && <SkillsView />}
      </div>
    </main>
  );
};
