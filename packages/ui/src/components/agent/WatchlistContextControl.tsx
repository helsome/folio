import React, { useEffect, useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import type { Run } from '@finagent/core';
import { useFinagentClient } from '../../client';
import { watchlistAtom } from '../../atoms/quoteAtoms';
import { watchlistContextEnabledAtomFamily } from '../../atoms/watchlistContextAtoms';

export function WatchlistContextControl({ sessionId, isRunning }: { sessionId: string; isRunning: boolean }) {
  const { t } = useTranslation();
  const client = useFinagentClient();
  const watchlist = useAtomValue(watchlistAtom);
  const [enabled, setEnabled] = useAtom(watchlistContextEnabledAtomFamily(sessionId));
  const [history, setHistory] = useState<{ sessionId: string; runs: Run[]; failed: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!isRunning) {
      void client.kernel.listRuns(sessionId).then((result) => {
        if (cancelled) return;
        setHistory({ sessionId, runs: result.ok ? result.data : [], failed: !result.ok });
      }).catch(() => {
        if (!cancelled) setHistory({ sessionId, runs: [], failed: true });
      });
    }
    return () => { cancelled = true; };
  }, [client, sessionId, isRunning]);

  const currentHistory = history?.sessionId === sessionId ? history : null;
  const runs = currentHistory?.runs.filter((run) => run.watchlistContext) ?? [];

  return (
    <div className="mb-3 space-y-2 text-sm text-foreground" data-testid="watchlist-context">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={enabled}
          disabled={isRunning || (!enabled && watchlist.length === 0)}
          onChange={(event) => setEnabled(event.target.checked)}
          className="accent-accent"
        />
        {t('agent.context.useWatchlist', { count: watchlist.length })}
      </label>
      {enabled && <p className="break-words">{watchlist.join(', ') || t('agent.context.emptyWatchlist')}</p>}
      {currentHistory?.failed && <p role="alert" className="text-destructive">{t('agent.context.historyFailed')}</p>}
      {runs.length > 0 && (
        <details>
          <summary className="cursor-pointer">{t('agent.context.watchlistHistory')}</summary>
          <ul className="mt-1 space-y-1">
            {runs.map((run) => (
              <li key={run.id} className="break-words rounded border border-border p-2">
                <p>{run.input}</p>
                <p>{run.watchlistContext?.instruments.map((instrument) => instrument.symbol).join(', ')}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
