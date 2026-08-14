import { describe, expect, it } from 'bun:test';
import type { ResearchSynthesisInput } from '@finagent/core';
import { LocalResearchSynthesizer } from './synthesizer-local.ts';

const synthesizer = new LocalResearchSynthesizer();

function input(overrides: Partial<ResearchSynthesisInput> = {}): ResearchSynthesisInput {
  return {
    symbol: 'NVDA.US',
    plannedCapabilities: ['market.quote', 'company.valuation', 'market.kline'],
    runs: [
      { capabilityId: 'market.quote', status: 'success' },
      { capabilityId: 'company.valuation', status: 'success' },
      { capabilityId: 'market.kline', status: 'success' },
    ],
    dataBundle: JSON.stringify({
      'market.quote': { change: 5 },
      'company.valuation': { pe: 25 },
      'market.kline': [{ close: 100 }, { close: 120 }],
    }),
    ...overrides,
  };
}

describe('LocalResearchSynthesizer', () => {
  it('derives stance from the majority of available verdicts', async () => {
    const synthesis = await synthesizer.synthesize(input());
    expect(synthesis.stance).toBe('bullish');
    // 3/3 successes → 1.0 raw, clamped to the 0.8 ceiling.
    expect(synthesis.confidence).toBe(0.8);
  });

  it('clamps confidence to 0.2..0.8 and never invents values', async () => {
    // 1 success of 3 planned → 1/3 stays inside the clamp range.
    const partial = await synthesizer.synthesize(
      input({
        runs: [
          { capabilityId: 'market.quote', status: 'success' },
          { capabilityId: 'company.valuation', status: 'unavailable' },
          { capabilityId: 'market.kline', status: 'failed', error: 'boom' },
        ],
        dataBundle: JSON.stringify({ 'market.quote': { change: 5 } }),
      })
    );
    expect(partial.confidence).toBeCloseTo(1 / 3);
    expect(partial.sections[0].verdict).toBe('positive');
    expect(partial.sections[1].verdict).toBe('unavailable');
    expect(partial.sections[1].summary).toContain('Valuation data unavailable.');
    expect(partial.sections[2].verdict).toBe('unavailable');

    // 1 success of 10 planned → 0.1 raw, clamped up to the 0.2 floor.
    const tenPlanned = input({
      plannedCapabilities: Array.from({ length: 10 }, (_, i) => `market.cap${i}`),
      runs: [{ capabilityId: 'market.cap0', status: 'success' }],
      dataBundle: JSON.stringify({ 'market.cap0': { change: 5 } }),
    });
    const floored = await synthesizer.synthesize(tenPlanned);
    expect(floored.confidence).toBe(0.2);
  });

  it('marks valuation unavailable when PE is missing', async () => {
    const synthesis = await synthesizer.synthesize(
      input({ dataBundle: JSON.stringify({ 'company.valuation': {} }) })
    );
    const valuation = synthesis.sections.find((s) => s.key === 'company.valuation');
    expect(valuation!.verdict).toBe('unavailable');
  });

  it('emits a section for every planned capability', async () => {
    const synthesis = await synthesizer.synthesize(input());
    expect(synthesis.sections.map((s) => s.key)).toEqual([
      'market.quote',
      'company.valuation',
      'market.kline',
    ]);
  });
});
