import React from 'react';
import { useAtom, useSetAtom } from 'jotai';
import {
  sessionsAtom,
  activeSessionIdAtom,
  createSessionAtom,
  watchlistAtom,
} from '@finagent/ui';
import { Watchlist } from '../stock/Watchlist';

export const Sidebar: React.FC = () => {
  const [sessions] = useAtom(sessionsAtom);
  const [activeSessionId] = useAtom(activeSessionIdAtom);
  const createSession = useSetAtom(createSessionAtom);
  const setActiveSessionId = useSetAtom(activeSessionIdAtom);

  return (
    <aside className="w-64 bg-[oklch(var(--bg-secondary))] flex flex-col border-r border-[oklch(var(--bg-primary))]">
      {/* Header */}
      <div className="p-4 border-b border-[oklch(var(--bg-primary))]">
        <button
          onClick={() => createSession()}
          className="w-full px-4 py-2 bg-[oklch(var(--accent-primary))] text-white rounded-lg hover:opacity-90 transition-opacity"
        >
          + New Session
        </button>
      </div>

      {/* Session List */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-2">
          <div className="text-xs font-semibold text-[oklch(var(--text-secondary))] uppercase tracking-wide px-2 py-2">
            Sessions
          </div>
          {sessions.map((session) => (
            <button
              key={session.id}
              onClick={() => setActiveSessionId(session.id)}
              className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                session.id === activeSessionId
                  ? 'bg-[oklch(var(--accent-primary))] text-white'
                  : 'hover:bg-[oklch(var(--bg-primary))] text-[oklch(var(--text-primary))]'
              }`}
            >
              <div className="font-medium truncate">{session.title}</div>
              <div className="text-xs opacity-70">
                {session.messages.length} messages
              </div>
            </button>
          ))}
          {sessions.length === 0 && (
            <div className="text-center py-8 text-[oklch(var(--text-secondary))]">
              No sessions yet
            </div>
          )}
        </div>
      </div>

      {/* Watchlist */}
      <div className="flex-1 border-t border-[oklch(var(--bg-primary))] overflow-hidden">
        <Watchlist />
      </div>
    </aside>
  );
};