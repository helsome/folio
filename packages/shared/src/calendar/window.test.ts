import { describe, expect, it } from 'bun:test';
import { isCalendarEventInWindow } from './window.ts';

const ms = Date.parse;
const usEvent = { localDate: '2026-05-20', market: 'US', symbol: 'NVDA.US' };
const eventTime = ms('2026-05-20T00:00:00Z');

describe('date-only calendar window', () => {
  it.each([
    ['before open', '2026-05-20T12:00:00Z', true],
    ['after UTC midnight', '2026-05-21T02:00:00Z', true],
    ['last market-local millisecond', '2026-05-21T03:59:59.999Z', true],
    ['next market-local day', '2026-05-21T04:00:00Z', false],
    ['seven calendar days away', '2026-05-13T12:00:00Z', true],
    ['eight calendar days away', '2026-05-12T12:00:00Z', false],
  ])('%s', (_name, at, expected) => {
    expect(isCalendarEventInWindow(usEvent, eventTime, ms(at), 7)).toBe(expected);
  });

  it('treats a zero-day horizon as today only', () => {
    expect(isCalendarEventInWindow(usEvent, eventTime, ms('2026-05-20T12:00:00Z'), 0)).toBe(true);
    expect(isCalendarEventInWindow(usEvent, eventTime, ms('2026-05-19T12:00:00Z'), 0)).toBe(false);
    expect(isCalendarEventInWindow(usEvent, eventTime, ms('2026-05-21T12:00:00Z'), 0)).toBe(false);
  });

  it('uses the known symbol market when explicit market metadata is absent', () => {
    expect(isCalendarEventInWindow({ localDate: '2026-05-20', symbol: ' nvda.us ' }, eventTime,
      ms('2026-05-21T02:00:00Z'), 0)).toBe(true);
  });

  it.each(['HK', 'CN', 'SH', 'SZ', 'SG'])('uses the %s local date rather than UTC date', (market) => {
    const event = { localDate: '2026-05-20', market };
    expect(isCalendarEventInWindow(event, eventTime, ms('2026-05-19T16:00:00Z'), 0)).toBe(true);
    expect(isCalendarEventInWindow(event, eventTime, ms('2026-05-20T15:59:59.999Z'), 0)).toBe(true);
    expect(isCalendarEventInWindow(event, eventTime, ms('2026-05-20T16:00:00Z'), 0)).toBe(false);
  });

  it('does not turn the New York spring-forward week into an eight-day horizon', () => {
    const sevenDays = { localDate: '2026-03-08', market: 'US' };
    const eightDays = { localDate: '2026-03-09', market: 'US' };
    const now = ms('2026-03-02T04:30:00Z'); // March 1 23:30 EST
    expect(isCalendarEventInWindow(sevenDays, ms('2026-03-08T00:00:00Z'), now, 7)).toBe(true);
    expect(isCalendarEventInWindow(eightDays, ms('2026-03-09T00:00:00Z'), now, 7)).toBe(false);
  });

  it('includes the seventh calendar day across New York fall-back', () => {
    const event = { localDate: '2026-11-07', market: 'US' };
    const now = ms('2026-10-31T04:30:00Z'); // October 31 00:30 EDT
    expect(isCalendarEventInWindow(event, ms('2026-11-07T00:00:00Z'), now, 7)).toBe(true);
  });
});

describe('timestamp compatibility', () => {
  it.each([
    ['no local date', {}],
    ['unparseable local date', { localDate: 'invalid', market: 'US' }],
    ['impossible date', { localDate: '2026-02-30', market: 'US' }],
    ['non-ISO date', { localDate: '2026/05/20', market: 'US' }],
    ['date mismatch', { localDate: '2026-05-21', market: 'US' }],
    ['unknown market', { localDate: '2026-05-20', market: 'ZZ', symbol: 'NVDA.ZZ' }],
    ['object prototype name is not a market', { localDate: '2026-05-20', market: 'constructor' }],
  ])('preserves the epoch window for %s', (_name, event) => {
    expect(isCalendarEventInWindow(event, eventTime, ms('2026-05-20T12:00:00Z'), 7)).toBe(false);
    expect(isCalendarEventInWindow(event, eventTime, ms('2026-05-19T12:00:00Z'), 7)).toBe(true);
  });

  it('preserves an exact release timestamp with local date metadata', () => {
    const exact = ms('2026-05-20T12:00:00Z');
    expect(isCalendarEventInWindow(usEvent, exact, exact + 1, 7)).toBe(false);
    expect(isCalendarEventInWindow(usEvent, exact, exact, 0)).toBe(true);
    expect(isCalendarEventInWindow(usEvent, exact, exact - 1, 0)).toBe(false);
    expect(isCalendarEventInWindow(usEvent, exact, exact - 1, 7)).toBe(true);
  });

  it('keeps exact rolling-window upper boundaries inclusive', () => {
    const now = ms('2026-05-13T12:00:00Z');
    const end = ms('2026-05-20T12:00:00Z');
    expect(isCalendarEventInWindow(usEvent, end, now, 7)).toBe(true);
    expect(isCalendarEventInWindow(usEvent, end + 1, now, 7)).toBe(false);
  });
});
