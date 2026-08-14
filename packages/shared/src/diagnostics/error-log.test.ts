import { describe, expect, it } from 'bun:test';
import { ErrorLog } from './error-log.ts';

describe('ErrorLog', () => {
  it('normalizes entries so no undefined fields remain', () => {
    const log = new ErrorLog();
    log.push({ message: 'boom' });
    expect(log.recent(1)).toEqual([
      { at: expect.any(Number), source: null, message: 'boom', stack: null },
    ]);
  });

  it('recent(n) returns newest-first', () => {
    const log = new ErrorLog({ now: () => 0 });
    log.push({ message: 'first' });
    log.push({ message: 'second' });
    log.push({ message: 'third' });
    expect(log.recent(2).map((e) => e.message)).toEqual(['third', 'second']);
  });

  it('evicts the oldest entries beyond capacity', () => {
    const log = new ErrorLog({ capacity: 3, now: () => 0 });
    for (let i = 0; i < 5; i += 1) {
      log.push({ message: `e${i}` });
    }
    expect(log.size).toBe(3);
    expect(log.recent(3).map((e) => e.message)).toEqual(['e4', 'e3', 'e2']);
  });

  it('recent(0) and recent(negative) return empty', () => {
    const log = new ErrorLog();
    log.push({ message: 'boom' });
    expect(log.recent(0)).toEqual([]);
    expect(log.recent(-1)).toEqual([]);
  });

  it('clear empties the buffer', () => {
    const log = new ErrorLog();
    log.push({ message: 'boom' });
    log.clear();
    expect(log.size).toBe(0);
    expect(log.recent(5)).toEqual([]);
  });
});
