import React from 'react';
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

const RAIL_ITEMS: Array<{ key: NavSection; label: string; icon: IconType }> = [
  { key: 'today', label: 'Today', icon: LayoutDashboard },
  { key: 'discover', label: 'Discover', icon: Compass },
  { key: 'watchlist', label: 'Workspace', icon: ChartNoAxesCombined },
  { key: 'portfolio', label: 'Portfolio', icon: BriefcaseBusiness },
  { key: 'compare', label: 'Compare', icon: GitCompareArrows },
  { key: 'alerts', label: 'Alerts', icon: Bell },
  { key: 'research', label: 'Research', icon: BookOpen },
  { key: 'thesis', label: 'Thesis', icon: FileText },
  { key: 'skills', label: 'Skills', icon: Zap },
  // Folio V7 Evaluation Center (spec §61–68) — internal/advanced, after the
  // skill management entry so it reads as an agent-engineering tool.
  { key: 'evaluation', label: 'Evaluation', icon: FlaskConical },
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
  const client = useFinagentClient();
  const [sessions] = useAtom(sessionsAtom);
  const [activeSessionId, setActiveSessionId] = useAtom(activeSessionIdAtom);
  const createSession = useSetAtom(createSessionAtom);
  const deleteSession = useSetAtom(deleteSessionAtom);
  const [navSection, setNavSection] = useAtom(navSectionAtom);
  const [agentPanelVisible, setAgentPanelVisible] = useAtom(agentPanelVisibleAtom);

  return (
    <aside className="flex h-full min-w-0 bg-surface-muted">
      <nav aria-label="Global navigation" className="flex w-16 shrink-0 flex-col items-center border-r border-border bg-surface-muted px-2 py-2">
        <button type="button" aria-label="Folio home" onClick={() => setNavSection('today')} className="mb-5 flex h-9 w-9 items-center justify-center overflow-hidden rounded-[10px] bg-surface shadow-sm">
          <img src={folioLogoUrl} alt="" className="h-full w-full object-cover" draggable={false} />
        </button>
        <div className="flex flex-col items-center gap-1">
          {RAIL_ITEMS.map((item) => <IconRailButton key={item.key} item={item} active={navSection === item.key} onClick={() => setNavSection(item.key)} />)}
        </div>
        <div className="my-3 h-px w-7 bg-border" />
        <div className="flex flex-col items-center gap-1">
          <IconRailButton item={{ key: 'settings', label: 'Settings', icon: Settings }} active={navSection === 'settings'} onClick={() => setNavSection('settings')} />
        </div>
        <div className="mt-auto flex flex-col items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" aria-label="Agent Panel" aria-pressed={agentPanelVisible} onClick={() => setAgentPanelVisible(!agentPanelVisible)} className={`flex h-9 w-9 items-center justify-center rounded-[9px] transition-colors ${agentPanelVisible ? 'bg-accent/10 text-accent' : 'text-foreground/42 hover:bg-surface-hover hover:text-foreground'}`}>
                <PanelRight className="h-[17px] w-[17px]" strokeWidth={1.8} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Agent Panel</TooltipContent>
          </Tooltip>
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
          <div className="min-w-0">
            <p className="truncate text-[12px] font-semibold text-foreground">{navSection === 'watchlist' || navSection === 'sessions' ? 'Workspace' : navSection[0]?.toUpperCase() + navSection.slice(1)}</p>
            <p className="mt-0.5 text-[10px] text-foreground/42">Folio Financial Workbench</p>
          </div>
          {navSection !== 'settings' && <Activity className="h-3.5 w-3.5 text-foreground/28" />}
        </div>

        {(navSection === 'sessions' || navSection === 'watchlist') && (
          <>
            <section className="flex min-h-0 flex-[0.9] flex-col border-b border-border">
              <div className="flex items-center justify-between px-3 pb-1 pt-3">
                <span className="text-[10px] font-semibold uppercase tracking-[.12em] text-foreground/42">Sessions</span>
                <span className="tnum text-[10px] text-foreground/36">{sessions.length}</span>
              </div>
              <div className="px-2 pb-2">
                <button type="button" onClick={() => void createSession(client)} className="flex h-8 w-full items-center justify-center gap-1.5 rounded-[8px] bg-primary px-3 text-[12px] font-semibold text-primary-foreground transition-colors hover:bg-primary/88">
                  <CirclePlus className="h-3.5 w-3.5" /> New Session
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                {sessions.map((session) => (
                  <div key={session.id} className="group relative">
                    <button type="button" onClick={() => setActiveSessionId(session.id)} className={`flex w-full items-center rounded-[8px] py-1.5 pl-2 pr-7 text-left transition-colors ${session.id === activeSessionId ? 'bg-accent/10 text-foreground' : 'text-foreground/62 hover:bg-surface-hover hover:text-foreground'}`}>
                      <div className="min-w-0"><div className="truncate text-[12px] font-medium">{session.title}</div><div className="tnum mt-0.5 text-[10px] text-foreground/36">{session.messageCount} msgs</div></div>
                    </button>
                    <button type="button" onClick={(event) => { event.stopPropagation(); void deleteSession(client, session.id); }} aria-label={`Delete ${session.title}`} className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-[6px] text-foreground/32 opacity-0 transition-opacity hover:bg-negative/10 hover:text-negative group-hover:opacity-100"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                ))}
                {sessions.length === 0 && <div className="py-6 text-center text-[11px] text-foreground/38">No sessions yet</div>}
              </div>
            </section>
            <section className="flex min-h-0 flex-[1.25] flex-col overflow-hidden">
              <button type="button" onClick={() => setNavSection('watchlist')} className="flex items-center justify-between px-3 pb-1 pt-3 text-left"><span className="text-[10px] font-semibold uppercase tracking-[.12em] text-foreground/42">Watchlist</span><ChevronRight className="h-3.5 w-3.5 text-foreground/28" /></button>
              <div className="min-h-0 flex-1 overflow-hidden"><Watchlist showHeader={false} /></div>
            </section>
          </>
        )}

        {navSection !== 'sessions' && navSection !== 'watchlist' && navSection !== 'settings' && (
          <div className="border-b border-border px-2 py-3">
            <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[.12em] text-foreground/42">Workspace shortcut</p>
            <button type="button" onClick={() => setNavSection('watchlist')} className="flex w-full items-center gap-2 rounded-[8px] px-2 py-2 text-left text-[12px] text-foreground/58 hover:bg-surface-hover hover:text-foreground"><ChartNoAxesCombined className="h-3.5 w-3.5" />Watchlist</button>
          </div>
        )}

        {navSection === 'settings' && (
          <div className="border-b border-border px-2 py-3">
            <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[.12em] text-foreground/42">Settings</p>
            {['general', 'llm', 'connections', 'skills', 'performance', 'diagnostics', 'evaluation'].map((tab) => <SettingsNavButton key={tab} tab={tab} />)}
          </div>
        )}

        {(navSection === 'sessions' || navSection === 'watchlist') && <div className="mt-auto border-t border-border px-3 py-2 text-[10px] text-foreground/34">⌘K to search symbols and actions</div>}
      </div>
    </aside>
  );
};

const SettingsNavButton: React.FC<{ tab: string }> = ({ tab }) => {
  const [settingsTab, setSettingsTab] = useAtom(settingsTabAtom);
  return <button type="button" onClick={() => setSettingsTab(tab as SettingsTab)} className={`w-full rounded-[8px] px-2 py-1.5 text-left text-[12px] capitalize transition-colors ${settingsTab === tab ? 'bg-accent/10 font-medium text-foreground' : 'text-foreground/56 hover:bg-surface-hover hover:text-foreground'}`}>{tab === 'llm' ? 'Models' : tab}</button>;
};
