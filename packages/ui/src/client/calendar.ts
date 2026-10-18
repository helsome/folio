import type { ApiResult, CalendarEvent } from '@finagent/core';
import type { FinagentClient } from '../client';

/**
 * Defensive loader for the optional calendar IPC surface.
 *
 * `FinagentClient.market` has no calendar method in its public type yet, so the
 * channel is probed at runtime. The three outcomes stay distinct on purpose
 * (#330): "the provider returned nothing", "the channel is not wired" and "the
 * request failed" must never collapse into the same UI, because only the first
 * one is a real answer about the user's calendar.
 */
export interface CalendarCapableMarket {
  getCalendarEvents?: (input: { eventType?: string; symbols?: string[] }) => Promise<ApiResult<CalendarEvent[]>>;
}

export type CalendarEventsResult =
  | { status: 'ok'; events: CalendarEvent[] }
  | { status: 'unavailable' }
  | { status: 'error'; message: string };

export async function loadCalendarEvents(
  client: FinagentClient,
  input: { eventType?: string; symbols?: string[] } = {}
): Promise<CalendarEventsResult> {
  const market = client.market as unknown as CalendarCapableMarket | undefined;
  const getCalendarEvents = market?.getCalendarEvents;
  if (typeof getCalendarEvents !== 'function') return { status: 'unavailable' };
  try {
    const result = await getCalendarEvents(input);
    if (!result.ok) return { status: 'error', message: result.error?.message ?? '' };
    return { status: 'ok', events: Array.isArray(result.data) ? result.data : [] };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : '' };
  }
}
