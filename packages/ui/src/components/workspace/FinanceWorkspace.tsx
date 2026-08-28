import React from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import type { WorkspaceView } from '@finagent/core';
import { navSectionAtom, activeSymbolAtom, activeViewAtom } from '../../atoms';
import { SecurityHeader } from './SecurityHeader';
import { OverviewView } from './OverviewView';
import { FinancialsView } from './FinancialsView';
import { NewsView } from './NewsView';
import { ChartView } from './ChartView';
import { PortfolioSection } from './PortfolioSection';
import { AlertsSection } from './AlertsSection';
import { SkillsView } from '../settings/SkillsView';
import { SettingsView } from '../settings/SettingsView';
import { ResearchPanel } from '../research/ResearchPanel';
import { ThesisPanel } from '../thesis/ThesisPanel';
import { CompareWorkspace } from '../compare/CompareWorkspace';
import { TodayView } from '../today/TodayView';
import { DiscoverView } from '../discover/DiscoverView';
import { EvaluationCenter } from '../evaluation/EvaluationCenter';
import { EventsView } from '../events/EventsView';
import { ProfileSecurityView } from '../profile/ProfileSecurityView';
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs';
const WORKSPACE_TABS: { value: WorkspaceView; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'chart', label: 'Chart' },
  { value: 'financials', label: 'Financials' },
  { value: 'news', label: 'News' },
];



export const FinanceWorkspace: React.FC = () => {
  const navSection = useAtomValue(navSectionAtom);

  let content: React.ReactNode;
  switch (navSection) {
    case 'discover':
      content = <DiscoverView />;
      break;
    case 'today':
      content = <TodayView />;
      break;
    case 'portfolio':
      content = <PortfolioSection />;
      break;
    case 'alerts':
      content = <AlertsSection />;
      break;
    case 'events':
      content = <EventsView />;
      break;
    case 'profile':
      content = <ProfileSecurityView />;
      break;
    case 'skills':
      content = <SkillsView />;
      break;
    case 'settings':
      content = <SettingsView />;
      break;
    case 'research':
      content = <ResearchPanel />;
      break;
    case 'thesis':
      content = <ThesisPanel />;
      break;
    case 'compare':
      content = <CompareWorkspace />;
      break;
    case 'evaluation':
      content = <EvaluationCenter />;
      break;
    case 'sessions':
    case 'watchlist':
    default:
      content = <SecurityWorkspace />;
  }

  return (
    <div className="folio-finance-workspace h-full" data-testid="finance-workspace">
      {content}
    </div>
  );
};

const SecurityWorkspace: React.FC = () => {
  const { t } = useTranslation();
  const activeSymbol = useAtomValue(activeSymbolAtom);
  const activeView = useAtomValue(activeViewAtom);
  const setActiveView = useSetAtom(activeViewAtom);

  if (!activeSymbol) {
    return (
      <div className="flex h-full items-center justify-center bg-[#f7f8fa] p-6 text-center">
        <div className="w-full max-w-md rounded-[16px] border border-[var(--mac-border)] bg-white px-8 py-10 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="text-[15px] font-semibold text-foreground/80">
          {t('security.workspace.emptyTitle')}
          </div>
          <div className="mx-auto mt-2 max-w-sm text-[12px] leading-5 text-foreground/48">
            {t('security.workspace.emptySubtitle')}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="folio-security-workspace flex h-full flex-col bg-[#f7f8fa]">
      <SecurityHeader />
      <div className="border-b border-[var(--mac-border)] bg-white px-4">
        <Tabs value={activeView} onValueChange={(value) => setActiveView(value as WorkspaceView)}>
          <TabsList className="gap-0 border-0">
            {WORKSPACE_TABS.map((tab) => <TabsTrigger key={tab.value} value={tab.value}>{tab.label}</TabsTrigger>)}
          </TabsList>
        </Tabs>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ActiveView view={activeView} />
      </div>
    </div>
  );
};

const ActiveView: React.FC<{ view: WorkspaceView }> = ({ view }) => {
  switch (view) {
    case 'chart':
      return <ChartView />;
    case 'financials':
      return <FinancialsView />;
    case 'news':
      return <NewsView />;
    case 'overview':
    case 'portfolio':
    default:
      return <OverviewView />;
  }
};
