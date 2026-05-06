import { afterEach, describe, expect, it } from 'bun:test';
import { registerProviderOverrides, registerTools, tools } from './index.ts';

afterEach(() => {
  delete process.env.ANTHROPIC_BASE_URL;
});

describe('pi extension registration', () => {
  it('registers all finance tools', () => {
    const registered: string[] = [];

    registerTools({
      registerTool: (tool) => {
        registered.push(tool.name);
      },
    });

    expect(registered).toEqual(tools.map((tool) => tool.name));
  });

  it('overrides anthropic baseUrl for MiniMax-compatible runtimes', () => {
    const calls: Array<{ name: string; config: { baseUrl?: string } }> = [];

    registerProviderOverrides({
      registerTool: () => undefined,
      registerProvider: (name, config) => {
        calls.push({ name, config });
      },
    });

    expect(calls).toEqual([
      {
        name: 'anthropic',
        config: { baseUrl: 'https://api.minimaxi.com/anthropic' },
      },
    ]);
  });

  it('prefers ANTHROPIC_BASE_URL from the environment', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://example.test/anthropic';
    const calls: Array<{ name: string; config: { baseUrl?: string } }> = [];

    registerProviderOverrides({
      registerTool: () => undefined,
      registerProvider: (name, config) => {
        calls.push({ name, config });
      },
    });

    expect(calls[0]).toEqual({
      name: 'anthropic',
      config: { baseUrl: 'https://example.test/anthropic' },
    });
  });
});
