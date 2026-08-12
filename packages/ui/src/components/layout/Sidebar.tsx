import React from 'react';
import { useAtom, useSetAtom } from 'jotai';
import {
  sessionsAtom,
  activeSessionIdAtom,
  createSessionAtom,
} from '../../atoms';
import { useFinagentClient } from '../../client';
import { Watchlist } from '../stock/Watchlist';

export const Sidebar: React.FC = () => {
  const client = useFinagentClient();
  const [sessions] = useAtom(sessionsAtom);
  const [activeSessionId] = useAtom(activeSessionIdAtom);
  const createSession = useSetAtom(createSessionAtom);
  const setActiveSessionId = useSetAtom(activeSessionIdAtom);

  return (
    <aside className="mac-sidebar flex w-[17rem] flex-col">
      <div className="border-b mac-section-divider px-3.5 py-3">
        <button
          onClick={() => void createSession(client)}
          className="mac-primary-button flex h-9 w-full items-center justify-center gap-2 rounded-[10px] px-4 text-[13px] font-semibold transition-smooth active:scale-[0.985]"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M7 2.5v9M2.5 7h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <span>New Session</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-hover">
        <div className="p-2.5">
          <div className="px-2 pb-2 pt-1 text-[11px] font-semibold uppercase text-foreground/42">
            Sessions
          </div>
          {sessions.map((session) => (
            <button
              key={session.id}
              onClick={() => setActiveSessionId(session.id)}
              className={`mac-list-row mb-1 w-full rounded-[10px] px-3 py-2.5 text-left ${
                session.id === activeSessionId
                  ? 'mac-list-row-active'
                  : 'text-foreground/76 hover:text-foreground active:scale-[0.99]'
              }`}
            >
              <div className="truncate text-[13px] font-semibold">{session.title}</div>
              <div className="mt-0.5 text-[11px] opacity-56">
                {session.messageCount} messages
              </div>
            </button>
          ))}
          {sessions.length === 0 && (
            <div className="py-10 text-center text-[13px] text-foreground/42">
              No sessions yet
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-hidden border-t mac-section-divider">
        <Watchlist />
      </div>
    </aside>
  );
};
