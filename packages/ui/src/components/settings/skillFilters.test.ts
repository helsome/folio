import { describe, expect, it } from 'bun:test';
import type { SkillReadiness } from '@finagent/core';
import type { SkillListItem } from '../../client';
import { filterSkills, matchesSkillQuery, matchesSkillStatus } from './skillFilters';

function skill(overrides: Partial<SkillListItem> = {}): SkillListItem {
  return {
    id: 'longbridge',
    name: 'Longbridge',
    keywords: ['quote', 'kline'],
    enabled: true,
    description: 'Market data via Longbridge CLI',
    source: 'bundled',
    ...overrides,
  };
}

function readiness(status: SkillReadiness['status'], missing: string[] = []): SkillReadiness {
  return {
    skillId: 'longbridge',
    status,
    required: ['market.quote', 'market.kline'],
    optional: [],
    availableRequired: status === 'ready' ? 2 : 1,
    availableOptional: 0,
    missing,
    summary: `${status === 'ready' ? 2 : 1}/2 capabilities`,
  };
}

describe('matchesSkillQuery', () => {
  it('matches the name case-insensitively', () => {
    expect(matchesSkillQuery(skill(), 'long')).toBe(true);
    expect(matchesSkillQuery(skill(), 'LONG')).toBe(true);
  });

  it('matches the description', () => {
    expect(matchesSkillQuery(skill(), 'market data')).toBe(true);
  });

  it('matches a trigger keyword', () => {
    expect(matchesSkillQuery(skill(), 'KLINE')).toBe(true);
  });

  it('matches the id', () => {
    expect(matchesSkillQuery(skill({ name: 'x', description: '' }), 'longbridge')).toBe(true);
  });

  it('returns true for an empty query', () => {
    expect(matchesSkillQuery(skill(), '   ')).toBe(true);
  });

  it('returns false when nothing matches', () => {
    expect(matchesSkillQuery(skill(), 'zzzz')).toBe(false);
  });
});

describe('matchesSkillStatus', () => {
  it('all matches everything, including disabled skills', () => {
    expect(matchesSkillStatus(skill(), readiness('ready'), 'all')).toBe(true);
    expect(matchesSkillStatus(skill({ enabled: false }), undefined, 'all')).toBe(true);
  });

  it('ready matches only ready readiness', () => {
    expect(matchesSkillStatus(skill(), readiness('ready'), 'ready')).toBe(true);
    expect(matchesSkillStatus(skill(), readiness('partial'), 'ready')).toBe(false);
    expect(matchesSkillStatus(skill(), undefined, 'ready')).toBe(false);
  });

  it('partial matches partial and unavailable (needs-attention bucket)', () => {
    expect(matchesSkillStatus(skill(), readiness('partial'), 'partial')).toBe(true);
    expect(matchesSkillStatus(skill(), readiness('unavailable'), 'partial')).toBe(true);
    expect(matchesSkillStatus(skill(), readiness('ready'), 'partial')).toBe(false);
  });

  it('disabled matches only the enabled flag', () => {
    expect(matchesSkillStatus(skill({ enabled: false }), readiness('ready'), 'disabled')).toBe(true);
    expect(matchesSkillStatus(skill({ enabled: true }), readiness('unavailable'), 'disabled')).toBe(false);
  });
});

describe('filterSkills', () => {
  const skills: SkillListItem[] = [
    skill({ id: 'a', name: 'Alpha', enabled: true }),
    skill({ id: 'b', name: 'Beta', enabled: false }),
    skill({ id: 'c', name: 'Gamma', enabled: true }),
  ];
  const readinessList: SkillReadiness[] = [
    { ...readiness('ready'), skillId: 'a' },
    { ...readiness('partial', ['market.kline']), skillId: 'b' },
    { ...readiness('unavailable', ['market.quote', 'market.kline']), skillId: 'c' },
  ];

  it('returns everything with no query and all status', () => {
    expect(filterSkills(skills, readinessList, '', 'all')).toHaveLength(3);
  });

  it('filters by ready status', () => {
    expect(filterSkills(skills, readinessList, '', 'ready').map((s) => s.id)).toEqual(['a']);
  });

  it('filters by partial status (includes unavailable)', () => {
    expect(filterSkills(skills, readinessList, '', 'partial').map((s) => s.id)).toEqual(['b', 'c']);
  });

  it('filters by disabled status', () => {
    expect(filterSkills(skills, readinessList, '', 'disabled').map((s) => s.id)).toEqual(['b']);
  });

  it('combines query and status filters', () => {
    expect(filterSkills(skills, readinessList, 'gam', 'partial').map((s) => s.id)).toEqual(['c']);
    expect(filterSkills(skills, readinessList, 'gam', 'disabled')).toEqual([]);
  });
});
