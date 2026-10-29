import type { CalendarEvent } from '@finagent/core';

const DAY_MS = 86_400_000;
const MARKET_TIME_ZONES = new Map([
  ['US', 'America/New_York'],
  ['HK', 'Asia/Hong_Kong'],
  ['CN', 'Asia/Shanghai'],
  ['SH', 'Asia/Shanghai'],
  ['SZ', 'Asia/Shanghai'],
  ['SG', 'Asia/Singapore'],
]);

type CalendarTiming = Pick<Partial<CalendarEvent>, 'localDate' | 'market' | 'symbol'>;

/**
 * Calendar feeds can represent a whole event date as UTC midnight, even for
 * after-market earnings. Only that date-only shape uses inclusive market-local
 * calendar days; precise timestamps and legacy events keep the rolling window.
 * This does not infer a release time within the event's local date.
 */
export function isCalendarEventInWindow(
  event: CalendarTiming,
  eventTimeMs: number,
  nowMs: number,
  horizonDays: number
): boolean {
  const timestampMatches = eventTimeMs >= nowMs && eventTimeMs <= nowMs + horizonDays * DAY_MS;
  const localDate = event.localDate;
  if (typeof localDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(localDate)) {
    return timestampMatches;
  }
  const eventDay = Date.parse(localDate);
  if (!Number.isFinite(eventDay) || new Date(eventDay).toISOString().slice(0, 10) !== localDate
    || eventTimeMs !== eventDay || !Number.isFinite(nowMs)) {
    return timestampMatches;
  }
  const market = typeof event.market === 'string' ? event.market.trim().toUpperCase() : '';
  const suffix = typeof event.symbol === 'string' ? event.symbol.trim().toUpperCase().split('.').pop() : '';
  const timeZone = MARKET_TIME_ZONES.get(market) ?? MARKET_TIME_ZONES.get(suffix ?? '');
  if (!timeZone) return timestampMatches;

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(nowMs);
  const datePart = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  const today = Date.parse(`${datePart('year')}-${datePart('month')}-${datePart('day')}`);
  // Add calendar days on this date-only axis, so DST cannot shorten/extend it.
  return eventDay >= today && eventDay <= today + horizonDays * DAY_MS;
}
