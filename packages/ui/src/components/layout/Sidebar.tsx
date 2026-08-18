import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAtom, useSetAtom } from 'jotai';
import {
  Activity,
  Bell,
  BookOpen,
  BriefcaseBusiness,
  ChartNoAxesCombined,
  ChevronRight,
  CirclePlus,
  Compass,
  FileText,
  FlaskConical,
  Gauge,
  GitCompareArrows,
  LayoutDashboard,
  PanelRight,
  Settings,
  Trash2,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  sessionsAtom,
  activeSessionIdAtom,
  createSessionAtom,
  deleteSessionAtom,
  navSectionAtom,
  agentPanelVisibleAtom,
  settingsTabAtom,
  type NavSection,
  type SettingsTab,
} from '../../atoms';
import { useFinagentClient } from '../../client';
import { Watchlist } from '../stock/Watchlist';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';

type IconType = LucideIcon;
const folioLogoUrl = new URL('../../assets/folio-logo.png', import.meta.url).href;

const RAIL_ITEMS: Array<{ key: NavSection; labelKey: string; icon: IconType }> = [
  { key: 'today', labelKey: 'today', icon: LayoutDashboard },
  { key: 'discover', labelKey: 'discover', icon: Compass },
  { key: 'watchlist', labelKey: 'workspace', icon: ChartNoAxesCombined },
  { key: 'portfolio', labelKey: 'portfolio', icon: BriefcaseBusiness },
  { key: 'compare', labelKey: 'compare', icon: GitCompareArrows },
  { key: 'alerts', labelKey: 'alerts', icon: Bell },
  { key: 'research', labelKey: 'research', icon: BookOpen },
  { key: 'thesis', labelKey: 'thesis', icon: FileText },
  { key: 'skills', labelKey: 'skills', icon: Zap },
  // Folio V7 Evaluation Center (spec §61–68) — internal/advanced, after the
  // skill management entry so it reads as an agent-engineering tool.
  { key: 'evaluation', labelKey: 'evaluation', icon: FlaskConical },
];

const IconRailButton: React.FC<{
  item: { key: NavSection; label: string; icon: IconType };
  active: boolean;
  onClick: () => void;
}> = ({ item, active, onClick }) => {
  const Icon = item.icon;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={item.label}
          aria-pressed={active}
          onClick={onClick}
          className={`relative flex h-9 w-9 items-center justify-center rounded-[9px] transition-colors ${
            active ? 'bg-accent/12 text-accent' : 'text-foreground/48 hover:bg-surface-hover hover:text-foreground'
          }`}
        >
          {active && <span className="absolute -left-2 h-4 w-0.5 rounded-full bg-accent" aria-hidden="true" />}
          <Icon className="h-[17px] w-[17px]" strokeWidth={active ? 2.1 : 1.7} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
};

export const Sidebar: React.FC = () => {
  const { t } = useTranslation();
  const client = useFinagentClient();
  const [sessions] = useAtom(sessionsAtom);
  const [activeSessionId, setActiveSessionId] = useAtom(activeSessionIdAtom);
  const createSession = useSetAtom(createSessionAtom);
  const deleteSession = useSetAtom(deleteSessionAtom);
  const [navSection, setNavSection] = useAtom(navSectionAtom);
  const [agentPanelVisible, setAgentPanelVisible] = useAtom(agentPanelVisibleAtom);

  const railItems = RAIL_ITEMS.map((item) => ({ ...item, label: t(`navigation.${item.labelKey}`) }));

  return (
    <aside className="flex h-full min-w-0 bg-surface-muted">
      <nav aria-label={t('navigation.globalNavAria')} className="flex w-16 shrink-0 flex-col items-center border-r border-border bg-surface-muted px-2 py-2">
        <button type="button" aria-label={t('navigation.homeAria')} onClick={() => setNavSection('today')} className="mb-5 flex h-9 w-9 items-center justify-center overflow-hidden rounded-[10px] bg-surface shadow-sm">
          <img src={folioLogoUrl} alt="" className="h-full w-full object-cover" draggable={false} />
        </button>
        <div className="flex flex-col items-center gap-1">
          {railItems.map((item) => <IconRailButton key={item.key} item={item} active={navSection === item.key} onClick={() => setNavSection(item.key)} />)}
        </div>
        <div className="my-3 h-px w-7 bg-border" />
        <div className="flex flex-col items-center gap-1">
          <IconRailButton item={{ key: 'settings', label: t('navigation.settings'), icon: Settings }} active={navSection === 'settings'} onClick={() => setNavSection('settings')} />
        </div>
        <div className="mt-auto flex flex-col items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" aria-label={t('navigation.agentPanelLabel')} aria-pressed={agentPanelVisible} onClick={() => setAgentPanelVisible(!agentPanelVisible)} className={`flex h-9 w-9 items-center justify-center rounded-[9px] transition-colors ${agentPanelVisible ? 'bg-accent/10 text-accent' : 'text-foreground/42 hover:bg-surface-hover hover:text-foreground'}`}>
                <PanelRight className="h-[17px] w-[17px]" strokeWidth={1.8} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{t('navigation.agentPanelLabel')}</TooltipContent>
          </Tooltip>
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
          <div className="min-w-0">
            <p className="truncate text-[12px] font-semibold text-foreground">{navSection === 'watchlist' || navSection === 'sessions' ? t('navigation.workspace') : t(`navigation.${navSection}`)}</p>
            <p className="mt-0.5 text-[10px] text-foreground/42">{t('navigation.subtitle')}</p>
          </div>
          {navSection !== 'settings' && <Activity className="h-3.5 w-3.5 text-foreground/28" />}
        </div>

        {(navSection === 'sessions' || navSection === 'watchlist') && (
          <>
            <section className="flex min-h-0 flex-[0.9] flex-col border-b border-border">
              <div className="flex items-center justify-between px-3 pb-1 pt-3">
                <span className="text-[10px] font-semibold uppercase tracking-[.12em] text-foreground/42">{t('navigation.sessions')}</span>
                <span className="tnum text-[10px] text-foreground/36">{sessions.length}</span>
              </div>
              <div className="px-2 pb-2">
                <button type="button" onClick={() => void createSession(client)} className="flex h-8 w-full items-center justify-center gap-1.5 rounded-[8px] bg-primary px-3 text-[12px] font-semibold text-primary-foreground transition-colors hover:bg-primary/88">
                  <CirclePlus className="h-3.5 w-3.5" /> {t('navigation.newSession')}
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                {sessions.map((session) => (
                  <div key={session.id} className="group relative">
                    <button type="button" onClick={() => setActiveSessionId(session.id)} className={`flex w-full items-center rounded-[8px] py-1.5 pl-2 pr-7 text-left transition-colors ${session.id === activeSessionId ? 'bg-accent/10 text-foreground' : 'text-foreground/62 hover:bg-surface-hover hover:text-foreground'}`}>
                      <div className="min-w-0"><div className="truncate text-[12px] font-medium">{session.title}</div><div className="tnum mt-0.5 text-[10px] text-foreground/36">{t('navigation.messagesCount', { count: session.messageCount })}</div></div>
                    </button>
                    <button type="button" onClick={(event) => { event.stopPropagation(); void deleteSession(client, session.id); }} aria-label={t('navigation.deleteSession', { title: session.title })} className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-[6px] text-foreground/32 opacity-0 transition-opacity hover:bg-negative/10 hover:text-negative group-hover:opacity-100"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                ))}
                {sessions.length === 0 && <div className="py-6 text-center text-[11px] text-foreground/38">{t('navigation.noSessions')}</div>}
              </div>
            </section>
            <section className="flex min-h-0 flex-[1.25] flex-col overflow-hidden">
              <button type="button" onClick={() => setNavSection('watchlist')} className="flex items-center justify-between px-3 pb-1 pt-3 text-left"><span className="text-[10px] font-semibold uppercase tracking-[.12em] text-foreground/42">{t('navigation.watchlist')}</span><ChevronRight className="h-3.5 w-3.5 text-foreground/28" /></button>
              <div className="min-h-0 flex-1 overflow-hidden"><Watchlist showHeader={false} /></div>
            </section>
          </>
        )}

        {navSection !== 'sessions' && navSection !== 'watchlist' && navSection !== 'settings' && (
          <div className="border-b border-border px-2 py-3">
            <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[.12em] text-foreground/42">{t('navigation.shortcut')}</p>
            <button type="button" onClick={() => setNavSection('watchlist')} className="flex w-full items-center gap-2 rounded-[8px] px-2 py-2 text-left text-[12px] text-foreground/58 hover:bg-surface-hover hover:text-foreground"><ChartNoAxesCombined className="h-3.5 w-3.5" />{t('navigation.watchlist')}</button>
          </div>
        )}

        {navSection === 'settings' && (
          <div className="border-b border-border px-2 py-3">
            <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[.12em] text-foreground/42">{t('navigation.settings')}</p>
            {['general', 'llm', 'connections', 'skills', 'performance', 'diagnostics', 'evaluation'].map((tab) => <SettingsNavButton key={tab} tab={tab} />)}
          </div>
        )}

        {(navSection === 'sessions' || navSection === 'watchlist') && <div className="mt-auto border-t border-border px-3 py-2 text-[10px] text-foreground/34">{t('navigation.paletteHint')}</div>}
      </div>
    </aside>
  );
};

const SETTINGS_TAB_LABEL_KEY: Record<SettingsTab, string> = {
  general: 'settingsTabGeneral',
  llm: 'settingsTabLlm',
  connections: 'settingsTabConnections',
  skills: 'settingsTabSkills',
  performance: 'settingsTabPerformance',
  diagnostics: 'settingsTabDiagnostics',
  evaluation: 'settingsTabEvaluation',
};

const SettingsNavButton: React.FC<{ tab: string }> = ({ tab }) => {
  const [settingsTab, setSettingsTab] = useAtom(settingsTabAtom);
  const { t } = useTranslation();
  const labelKey = SETTINGS_TAB_LABEL_KEY[tab as SettingsTab] ?? tab;
  return <button type="button" onClick={() => setSettingsTab(tab as SettingsTab)} className={`w-full rounded-[8px] px-2 py-1.5 text-left text-[12px] capitalize transition-colors ${settingsTab === tab ? 'bg-accent/10 font-medium text-foreground' : 'text-foreground/56 hover:bg-surface-hover hover:text-foreground'}`}>{t(`navigation.${labelKey}`)}</button>;
};
