import { describe, expect, it } from 'bun:test';
import { flipSkillEnabled } from './skillToggleState';

describe('flipSkillEnabled', () => {
  const items = [
    { id: 'a', enabled: true, name: 'Alpha' },
    { id: 'b', enabled: false, name: 'Beta' },
  ];

  it('flips only the target skill and preserves the rest by reference', () => {
    const next = flipSkillEnabled(items, 'a');
    expect(next[0].enabled).toBe(false);
    expect(next[1]).toBe(items[1]);
    expect(next[1].enabled).toBe(false);
  });

  it('is its own inverse (optimistic update, then rollback)', () => {
    const optimistic = flipSkillEnabled(items, 'a');
    const rolledBack = flipSkillEnabled(optimistic, 'a');
    expect(rolledBack[0].enabled).toBe(items[0].enabled);
    expect(rolledBack[0]).not.toBe(items[0]);
    expect(rolledBack[0]).toEqual(items[0]);
  });

  it('leaves the list unchanged for an unknown id', () => {
    expect(flipSkillEnabled(items, 'nope')).toEqual(items);
  });

  it('does not mutate the input array', () => {
    const snapshot = items.map((item) => ({ ...item }));
    flipSkillEnabled(items, 'a');
    expect(items).toEqual(snapshot);
  });
});
