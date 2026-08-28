import React, { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, CalendarDays, RefreshCw, Sparkles } from 'lucide-react';
import { useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import type { ApiResult, CalendarEvent } from '@finagent/core';
import { activeSymbolAtom, navSectionAtom } from '../../atoms';
import { useFinagentClient } from '../../client';
import { mapUpcomingEvents, type UpcomingEventItem } from '../../atoms/todayAtoms';
import { demoCalendarEvents } from '../../demo/demoData';
import { Button } from '../primitives/Button';
import { DemoBadge } from '../primitives/DemoBadge';
import { SectionState } from '../today/TodaySection';

interface CalendarCapableMarket {
  getCalendarEvents?: (input: { eventType?: string; symbols?: string[] }) => Promise<ApiResult<CalendarEvent[]>>;
}

function formatEventDate(event: UpcomingEventItem): string {
  if (event.localDate) return event.localDate;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(event.date * 1000);
}

/** Stitch Events & Catalysts surface, backed only by the optional calendar channel. */
export const EventsView: React.FC = () => {
  const { t } = useTranslation();
  const client = useFinagentClient();
  const setActiveSymbol = useSetAtom(activeSymbolAtom);
  const setNavSection = useSetAtom(navSectionAtom);
  const [events, setEvents] = useState<UpcomingEventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDemo, setIsDemo] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const calendar = client.market as unknown as CalendarCapableMarket;
    if (typeof calendar.getCalendarEvents !== 'function') {
      // Channel not wired: badged sample events instead of a blank page.
      setIsDemo(true);
      setEvents(mapUpcomingEvents(demoCalendarEvents(t)));
      setLoading(false);
      return;
    }
    try {
      const result = await calendar.getCalendarEvents({ eventType: 'financial' });
      if (!result.ok || result.data.length === 0) {
        // Provider error or genuinely empty calendar: badged sample events.
        setIsDemo(true);
        setEvents(mapUpcomingEvents(demoCalendarEvents(t)));
      } else {
        setIsDemo(false);
        setEvents(mapUpcomingEvents(result.data));
      }
    } catch {
      setIsDemo(true);
      setEvents(mapUpcomingEvents(demoCalendarEvents(t)));
    } finally {
      setLoading(false);
    }
  }, [client, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openResearch = (symbol: string) => {
    if (!symbol) return;
    setActiveSymbol(symbol);
    setNavSection('research');
  };

  const state = loading ? 'loading' : error ? 'error' : events.length === 0 ? 'empty' : null;

  return (
    <main className="folio-page folio-events-view flex h-full min-h-0 flex-col overflow-y-auto bg-background" data-testid="events-view">
      <header className="folio-page-header flex shrink-0 items-start justify-between gap-4 border-b border-border bg-surface px-6 py-5">
        <div>
          <div className="folio-eyebrow"><CalendarDays className="h-3.5 w-3.5" />{t('events.eyebrow')}</div>
          <h1 className="folio-page-title">{t('events.title')}</h1>
          <p className="folio-page-subtitle">{t('events.subtitle')}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          {t('common.refresh')}
        </Button>
      </header>

      <div className="grid min-h-0 flex-1 gap-5 p-6 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <section className="folio-page-section min-w-0">
          <div className="folio-section-heading">
            <div>
              <div className="folio-eyebrow">{t('events.upcomingEyebrow')}</div>
              <h2>{t('events.upcomingTitle')}</h2>
            </div>
            <span className="flex items-center gap-2">
              {isDemo && <DemoBadge />}
              <span className="folio-count-badge">{events.length || '—'}</span>
            </span>
          </div>

          {state === 'loading' && <SectionState kind="loading" message={t('events.loading')} />}
          {state === 'error' && <SectionState kind="error" message={error ?? t('events.loadError')} />}
          {state === 'empty' && <SectionState kind="empty" message={t('events.empty')} />}

          {events.length > 0 && (
            <div className="folio-events-list" data-testid="events-list">
              {events.map((event) => (
                <article key={event.id} className="folio-event-row">
                  <div className="folio-event-date tnum">{formatEventDate(event)}</div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="folio-event-type">{event.type || t('events.event')}</span>
                      {event.symbol && <span className="folio-event-symbol">{event.symbol}</span>}
                    </div>
                    <h3>{event.name || event.symbol || t('events.marketEvent')}</h3>
                    <p>{event.content || t('events.noDescription')}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {event.symbol && (
                      <button type="button" className="folio-icon-action" aria-label={t('events.openResearch', { symbol: event.symbol })} onClick={() => openResearch(event.symbol)}>
                        <ArrowUpRight className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <aside className="folio-events-rail folio-page-section h-fit">
          <div className="folio-eyebrow"><Sparkles className="h-3.5 w-3.5" />{t('events.catalystEyebrow')}</div>
          <h2 className="mt-2">{t('events.catalystTitle')}</h2>
          <p className="mt-2 text-[12px] leading-relaxed text-foreground/58">{t('events.catalystEmpty')}</p>
          <div className="mt-5 border-t border-border pt-4 text-[11px] leading-relaxed text-foreground/42">
            {t('events.catalystHint')}
          </div>
        </aside>
      </div>
    </main>
  );
};
