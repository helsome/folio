import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'bun:test';
import { skillCapabilityMap } from './capability-map.ts';

const ID_FORMAT = /^[a-z]+\.[a-zA-Z]+$/;

const SKILLS_DIR = resolve(import.meta.dir, '../../../skills');

/** Directory names (skill ids) of every vendored skill package. */
async function vendoredSkillIds(): Promise<string[]> {
  const entries = await readdir(SKILLS_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

describe('skillCapabilityMap', () => {
  it('has a mapping for every vendored skill', async () => {
    const ids = await vendoredSkillIds();
    expect(ids.length).toBe(13);
    for (const id of ids) {
      expect(skillCapabilityMap[id], `missing capability map for "${id}"`).toBeDefined();
    }
  });

  it('declares only well-formed capability ids', () => {
    for (const [skillId, requirements] of Object.entries(skillCapabilityMap)) {
      for (const id of [...requirements.required, ...requirements.optional]) {
        expect(ID_FORMAT.test(id), `${skillId} declares malformed id "${id}"`).toBe(true);
      }
    }
  });

  it('has no duplicate or overlapping requirement ids per skill', () => {
    for (const [skillId, requirements] of Object.entries(skillCapabilityMap)) {
      expect(new Set(requirements.required).size, `${skillId}: duplicate required ids`).toBe(
        requirements.required.length
      );
      expect(new Set(requirements.optional).size, `${skillId}: duplicate optional ids`).toBe(
        requirements.optional.length
      );
      const overlap = requirements.required.filter((id) => requirements.optional.includes(id));
      expect(overlap, `${skillId}: required/optional overlap`).toEqual([]);
    }
  });

  it('marks market.quote and market.kline as required for market-data', () => {
    expect(skillCapabilityMap['longbridge-market-data'].required).toContain('market.quote');
    expect(skillCapabilityMap['longbridge-market-data'].required).toContain('market.kline');
  });

  it('marks kline and quote as required for technical analysis', () => {
    expect(skillCapabilityMap['longbridge-technical'].required).toContain('market.kline');
    expect(skillCapabilityMap['longbridge-technical'].required).toContain('market.quote');
  });

  it('declares unimplemented commands as their own ids (never faked as covered)', () => {
    expect(skillCapabilityMap['longbridge-derivatives'].required).toEqual(
      expect.arrayContaining(['options.chain', 'options.greeks', 'options.warrants'])
    );
    expect(skillCapabilityMap['longbridge-intel'].required).toEqual(
      expect.arrayContaining(['intel.screener', 'intel.anomalies'])
    );
    expect(skillCapabilityMap['longbridge-content'].required).toContain('content.filings');
    expect(skillCapabilityMap['longbridge-watchlist'].required).toContain('watchlist.manage');
    expect(skillCapabilityMap['longbridge-research'].required).toEqual(
      expect.arrayContaining(['research.shareholders', 'research.insiderTrades'])
    );
  });
});
