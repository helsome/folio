import { describe, expect, it } from 'bun:test';
import type { SkillReadiness } from '@finagent/core';
import { getSkillReadiness, readinessVisual } from './skillReadinessAtoms';

describe('readinessVisual', () => {
  it('maps ready to a green filled dot', () => {
    expect(readinessVisual('ready')).toEqual({
      tone: 'ready',
      icon: '●',
      color: '#22c55e',
      label: 'Ready',
    });
  });

  it('maps partial to an amber half dot', () => {
    expect(readinessVisual('partial')).toEqual({
      tone: 'partial',
      icon: '◐',
      color: '#f59e0b',
      label: 'Partial',
    });
  });

  it('maps unavailable to a gray open dot', () => {
    expect(readinessVisual('unavailable')).toEqual({
      tone: 'unavailable',
      icon: '○',
      color: '#9ca3af',
      label: 'Unavailable',
    });
  });

  it('treats an undefined status as unavailable (graceful empty state)', () => {
    expect(readinessVisual(undefined)).toEqual(readinessVisual('unavailable'));
  });
});

describe('getSkillReadiness', () => {
  const entries: SkillReadiness[] = [
    {
      skillId: 'longbridge-market-data',
      status: 'ready',
      required: ['market.quote', 'market.kline'],
      optional: [],
      availableRequired: 2,
      availableOptional: 0,
      missing: [],
      summary: '2/2 capabilities',
    },
    {
      skillId: 'longbridge-derivatives',
      status: 'unavailable',
      required: ['options.chain', 'options.greeks'],
      optional: [],
      availableRequired: 0,
      availableOptional: 0,
      missing: ['options.chain', 'options.greeks'],
      summary: '0/2 capabilities',
    },
  ];

  it('finds the entry for a skill id', () => {
    expect(getSkillReadiness(entries, 'longbridge-market-data')?.status).toBe('ready');
  });

  it('returns undefined for an unknown skill id', () => {
    expect(getSkillReadiness(entries, 'nope')).toBeUndefined();
  });

  it('returns undefined for an empty list', () => {
    expect(getSkillReadiness([], 'longbridge-market-data')).toBeUndefined();
  });
});
