import { describe, expect, it } from 'bun:test';
import { Type } from '@sinclair/typebox';
import { defineCapability } from './define.ts';
import { createCapabilityTools } from './pi-tools.ts';

describe('createCapabilityTools', () => {
  it('generates one tool per capability with summary + DATA text', async () => {
    const cap = defineCapability({
      id: 'market.quote',
      name: 'Quote',
      description: 'Get a quote.',
      category: 'market',
      riskLevel: 'read',
      auth: 'public',
      toolName: 'get_quote',
      inputSchema: Type.Object({ symbol: Type.String() }),
      async execute(input: { symbol: string }) {
        return {
          data: { symbol: input.symbol },
          provenance: { provider: 'longbridge', fetchedAt: 0, stale: false },
          summary: `Quote for ${input.symbol}`,
        };
      },
    });

    const tools = createCapabilityTools([cap]);

    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      name: 'get_quote',
      label: 'Quote',
      description: 'Get a quote.',
    });

    const out = await tools[0].execute('call-1', { symbol: 'AAPL.US' }, new AbortController().signal);
    expect(out.content[0].text).toBe('Quote for AAPL.US\n\nDATA: {"symbol":"AAPL.US"}');
  });

  it('re-validates raw params inside execute', async () => {
    const cap = defineCapability({
      id: 'market.quote',
      name: 'Quote',
      description: 'Get a quote.',
      category: 'market',
      riskLevel: 'read',
      auth: 'public',
      toolName: 'get_quote',
      inputSchema: Type.Object({ symbol: Type.String() }),
      async execute() {
        return { data: {}, provenance: { provider: 'longbridge', fetchedAt: 0, stale: false } };
      },
    });

    const tools = createCapabilityTools([cap]);

    await expect(
      tools[0].execute('call-1', { symbol: 123 }, new AbortController().signal)
    ).rejects.toMatchObject({ code: 'CAPABILITY_INPUT_INVALID' });
  });
});
