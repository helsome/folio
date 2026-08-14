import React from 'react';
import { useAtom, useSetAtom } from 'jotai';
import {
  sessionsAtom,
  activeSessionIdAtom,
  createSessionAtom,
  deleteSessionAtom,
  navSectionAtom,
  agentPanelVisibleAtom,
  type NavSection,
} from '../../atoms';
import { useFinagentClient } from '../../client';
import { Watchlist } from '../stock/Watchlist';

const NAV_ITEMS: Array<{ key: NavSection; label: string; path: string }> = [
  {
    key: 'today',
    label: 'Today',
    path: 'M2.5 8.5h11a3 3 0 0 1-3 3h-5a3 3 0 0 1-3-3zM2.5 8.5a3 3 0 0 1 3-3h5a3 3 0 0 1 3 3M8 3.5V2M5 3.5V2M11 3.5V2',
  },
  {
    key: 'portfolio',
    label: 'Portfolio',
    path: 'M2.5 5.5h11v8h-11zM6 5.5V4a1.5 1.5 0 0 1 1.5-1.5h1A1.5 1.5 0 0 1 10 4v1.5',
  },
  {
    key: 'alerts',
    label: 'Alerts',
    path: 'M8 2.5a3 3 0 0 0-3 3v2L3.6 9a.6.6 0 0 0 .4 1h8a.6.6 0 0 0 .4-1L11 7.5v-2a3 3 0 0 0-3-3zM7.5 11.5h1',
  },
  {
    key: 'research',
    label: 'Research',
    path: 'M3 3.5h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H3zM5 8h3M8 6.5V9.5M6 11.5h4',
  },
  {
    key: 'thesis',
    label: 'Thesis',
    path: 'M4.5 2.5h7M4.5 6h7M4.5 9.5h7M3 13h10a1 1 0 0 1 0 2H3z',
  },
  {
    key: 'compare',
    label: 'Compare',
    path: 'M3.5 6.5h4v5h-4zM8.5 6.5h4v5h-4z',
  },
  {
    key: 'skills',
    label: 'Skills',
    path: 'M9 2 4.5 9H7.5L7 14l4.5-7H8.5z',
  },
  {
    key: 'settings',
    label: 'Settings',
    path: 'M8 1.8 9.4 3l2-.7 1.2 1.7 2.1.2.3 2.1 1.7 1.2-.2 2.1-2.1.3-1.2 1.7-2-.7-1.4-1.2-2 .7-1.2-1.7-2.1-.2-.3-2.1-1.7-1.2.2-2.1-2.1-.3L4.6 3l2 .7L8 1.8zm0 3.7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
  },
];

const NavIcon: React.FC<{ path: string }> = ({ path }) => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d={path} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const Sidebar: React.FC = () => {
  const client = useFinagentClient();
  const [sessions] = useAtom(sessionsAtom);
  const [activeSessionId, setActiveSessionId] = useAtom(activeSessionIdAtom);
  const createSession = useSetAtom(createSessionAtom);
  const deleteSession = useSetAtom(deleteSessionAtom);
  const [navSection, setNavSection] = useAtom(navSectionAtom);
  const [agentPanelVisible, setAgentPanelVisible] = useAtom(agentPanelVisibleAtom);

  return (
    <aside className="flex h-full flex-col bg-surface">
      {/* Sessions section */}
      <section className="flex min-h-0 flex-1 flex-col border-b mac-section-divider">
        <button
          onClick={() => setNavSection('sessions')}
          className={`flex w-full items-center justify-between px-3 pb-1 pt-2.5 text-[10.5px] font-semibold uppercase tracking-wider transition-smooth ${
            navSection === 'sessions' ? 'text-accent' : 'text-text-muted hover:text-foreground'
          }`}
        >
          <span>Sessions</span>
          <span className="tnum text-[10px] font-normal opacity-70">{sessions.length}</span>
        </button>
        <div className="px-2 pb-1.5">
          <button
            onClick={() => void createSession(client)}
            className="mac-primary-button flex h-7 w-full items-center justify-center gap-1.5 rounded-[8px] px-3 text-[12.5px] font-semibold transition-smooth active:scale-[0.985]"
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M7 2.5v9M2.5 7h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <span>New Session</span>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {sessions.map((session) => (
            <div key={session.id} className="group relative">
              <button
                onClick={() => setActiveSessionId(session.id)}
                className={`mac-list-row flex w-full items-center gap-2 rounded-[8px] py-1.5 pl-2 pr-7 text-left ${
                  session.id === activeSessionId
                    ? 'mac-list-row-active'
                    : 'text-foreground/72 hover:text-foreground active:scale-[0.99]'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-semibold leading-tight">{session.title}</div>
                  <div className="tnum mt-0.5 text-[10.5px] leading-none text-text-muted">
                    {session.messageCount} msgs
                  </div>
                </div>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void deleteSession(client, session.id);
                }}
                aria-label={`Delete ${session.title}`}
                className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-text-muted opacity-0 transition-smooth hover:text-negative group-hover:opacity-100"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path
                    d="M3 4.5h10M6.5 4.5V3h3v1.5M5 4.5l.5 9h5l.5-9"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          ))}
          {sessions.length === 0 && (
            <div className="py-8 text-center text-[12px] text-text-muted">No sessions yet</div>
          )}
        </div>
      </section>

      {/* Watchlist section */}
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden border-b mac-section-divider">
        <button
          onClick={() => setNavSection('watchlist')}
          className={`flex w-full items-center justify-between px-3 pb-1 pt-2.5 text-[10.5px] font-semibold uppercase tracking-wider transition-smooth ${
            navSection === 'watchlist' ? 'text-accent' : 'text-text-muted hover:text-foreground'
          }`}
        >
          <span>Watchlist</span>
        </button>
        <div className="min-h-0 flex-1 overflow-hidden">
          <Watchlist />
        </div>
      </section>

      {/* App navigation */}
      <nav className="flex flex-col px-2 py-1.5">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.key}
            onClick={() => setNavSection(item.key)}
            className={`flex h-7 w-full items-center gap-2 rounded-[8px] px-2 text-left text-[12.5px] font-medium transition-smooth ${
              navSection === item.key
                ? 'bg-[var(--mac-blue-soft)] text-foreground'
                : 'text-text-muted hover:bg-[var(--mac-sidebar-hover)] hover:text-foreground'
            }`}
          >
            <NavIcon path={item.path} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {/* Agent panel toggle */}
      <button
        onClick={() => setAgentPanelVisible(!agentPanelVisible)}
        aria-pressed={agentPanelVisible}
        className="flex h-8 w-full items-center gap-2 border-t mac-section-divider px-3 text-[12px] font-medium text-text-muted transition-smooth hover:bg-[var(--mac-sidebar-hover)] hover:text-foreground"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="2.5" y="2.5" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.4" />
          <path d="M9.5 2.5v11" stroke="currentColor" strokeWidth="1.4" />
        </svg>
        <span>Agent Panel</span>
        <span
          className={`ml-auto h-2 w-2 rounded-full transition-smooth ${
            agentPanelVisible ? 'bg-[var(--mac-green)]' : 'bg-foreground/25'
          }`}
        />
      </button>
    </aside>
  );
};
