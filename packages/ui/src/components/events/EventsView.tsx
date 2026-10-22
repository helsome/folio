import React, { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, CalendarDays, RefreshCw, Sparkles } from 'lucide-react';
import { useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { activeSymbolAtom, navSectionAtom } from '../../atoms';
import { useFinagentClient } from '../../client';
import { loadCalendarEvents, type CalendarEventsResult } from '../../client/calendar';
import { mapUpcomingEvents, type UpcomingEventItem } from '../../atoms/todayAtoms';
import { demoCalendarEvents } from '../../demo/demoData';
import { Button } from '../primitives/Button';
import { DemoBadge } from '../primitives/DemoBadge';
import { SectionState } from '../today/TodaySection';

function formatEventDate(event: UpcomingEventItem): string {
  if (event.localDate) return event.localDate;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(event.date * 1000);
}

/**
 * Stitch Events & Catalysts surface, backed only by the optional calendar
 * channel.
 *
 * A successful empty response, a missing channel and a provider failure are
 * three different answers (#330): only the first one describes the user's
 * calendar. Sample events are therefore opt-in — never a silent substitute for
 * a real result.
 */
export const EventsView: React.FC = () => {
  const { t } = useTranslation();
  const client = useFinagentClient();
  const setActiveSymbol = useSetAtom(activeSymbolAtom);
  const setNavSection = useSetAtom(navSectionAtom);
  const [result, setResult] = useState<CalendarEventsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSample, setShowSample] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const next = await loadCalendarEvents(client, { eventType: 'financial' });
    setResult(next);
    setLoading(false);
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openResearch = (symbol: string) => {
    if (!symbol) return;
    setActiveSymbol(symbol);
    setNavSection('research');
  };

  const realEvents = result?.status === 'ok' ? mapUpcomingEvents(result.events) : [];
  const sampleEvents = showSample ? mapUpcomingEvents(demoCalendarEvents(t)) : [];
  const isDemo = realEvents.length === 0 && sampleEvents.length > 0;
  const events = isDemo ? sampleEvents : realEvents;

  const status = (() => {
    if (loading) return 'loading';
    if (!result) return 'loading';
    if (result.status === 'unavailable') return 'unavailable';
    if (result.status === 'error') return 'error';
    return realEvents.length === 0 ? 'empty' : 'ready';
  })();

  const sampleButton = (
    <Button variant="outline" size="sm" onClick={() => setShowSample((previous) => !previous)}>
      {showSample ? t('events.hideSample') : t('events.showSample')}
    </Button>
  );

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

          {status === 'loading' && <SectionState kind="loading" message={t('events.loading')} />}

          {status === 'error' && (
            <div className="space-y-2" data-testid="events-error">
              <SectionState kind="error" message={t('events.loadError')} />
              <Button variant="outline" size="sm" onClick={() => void refresh()}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                {t('common.retry')}
              </Button>
            </div>
          )}

          {status === 'unavailable' && (
            <div className="space-y-2" data-testid="events-unavailable">
              <SectionState kind="empty" message={t('events.unavailable')} />
              {!showSample && sampleButton}
            </div>
          )}

          {status === 'empty' && !showSample && (
            <div className="space-y-2" data-testid="events-empty">
              <SectionState kind="empty" message={t('events.empty')} />
              {sampleButton}
            </div>
          )}
          {isDemo && (
            <p className="mb-2 text-[11px] text-foreground/45" data-testid="events-sample-note">
              {t('events.sampleNote')}
            </p>
          )}

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
                    {event.symbol && !isDemo && (
                      <button type="button" className="folio-icon-action" aria-label={t('events.openResearch', { symbol: event.symbol })} onClick={() => openResearch(event.symbol)}>
                        <ArrowUpRight className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}

          {isDemo && <div className="mt-3">{sampleButton}</div>}
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
