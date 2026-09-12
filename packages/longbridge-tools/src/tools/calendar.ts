import { executeLongBridge } from '../executor.ts';
import { parseCalendarResponse } from '../parser.ts';
import { LongBridgeError } from '../errors.ts';
import { validateSymbolOrThrow } from '../validator.ts';
import type { CalendarEvent } from '../types.ts';

export type CalendarEventType =
  | 'financial'
  | 'report'
  | 'dividend'
  | 'ipo'
  | 'macrodata'
  | 'closed';

export interface GetCalendarEventsOptions {
  /** Event type (positional argument; no default). */
  eventType: CalendarEventType;
  /** Optional symbol filter (repeatable, max 10). */
  symbols?: string[];
  /** Start date (YYYY-MM-DD), defaults to today. */
  start?: string;
  /** End date (YYYY-MM-DD), defaults to no limit. */
  end?: string;
  /** Max events returned (default 100). */
  count?: number;
}

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** Upcoming finance-calendar events of a given type. */
export async function getCalendarEvents(
  options: GetCalendarEventsOptions
): Promise<CalendarEvent[]> {
  for (const symbol of options.symbols ?? []) {
    validateSymbolOrThrow(symbol);
  }
  for (const [name, value] of [['start', options.start], ['end', options.end]] as const) {
    if (value !== undefined && !DATE_REGEX.test(value)) {
      throw new LongBridgeError(
        `INVALID_ARGUMENT: ${name} must be YYYY-MM-DD, got "${value}"`,
        'INVALID_ARGUMENT'
      );
    }
  }
  if (options.count !== undefined && (!Number.isInteger(options.count) || options.count < 1)) {
    throw new LongBridgeError(
      `INVALID_ARGUMENT: count must be a positive integer, got ${options.count}`,
      'INVALID_ARGUMENT'
    );
  }

  const args = ['finance-calendar', options.eventType];
  for (const symbol of options.symbols ?? []) {
    args.push('--symbol', symbol);
  }
  if (options.start) args.push('--start', options.start);
  if (options.end) args.push('--end', options.end);
  if (options.count !== undefined) args.push('--count', String(options.count));
  args.push('--format', 'json');
  const output = await executeLongBridge(args);
  return parseCalendarResponse(output);
}
