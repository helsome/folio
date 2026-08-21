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
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <div className="text-[15px] font-semibold text-foreground/72">
          {t('security.workspace.emptyTitle')}
        </div>
        <div className="max-w-sm text-[12px] text-foreground/44">
          {t('security.workspace.emptySubtitle')}
        </div>
      </div>
    );
  }

  return (
    <div className="folio-security-workspace flex h-full flex-col">
      <SecurityHeader />
      <div className="border-b mac-section-divider px-3">
        <Tabs value={activeView} onValueChange={(value) => setActiveView(value as WorkspaceView)}>
          <TabsList className="border-0">
            {WORKSPACE_TABS.map((tab) => <TabsTrigger key={tab.value} value={tab.value}>{tab.label}</TabsTrigger>)}
          </TabsList>
        </Tabs>
      </div>
      <div className="flex-1 overflow-y-auto">
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
