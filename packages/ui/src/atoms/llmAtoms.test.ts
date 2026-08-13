import { describe, expect, it } from 'bun:test';
import type { LlmModel } from '@finagent/core';
import { groupModelsByProvider } from './llmAtoms';

const models: LlmModel[] = [
  { id: 'claude-a', provider: 'anthropic', name: 'Claude A' },
  { id: 'gpt-a', provider: 'openai', name: 'GPT A' },
  { id: 'claude-b', provider: 'anthropic', name: 'Claude B' },
  { id: 'gemini-a', provider: 'google', name: 'Gemini A' },
];

describe('groupModelsByProvider', () => {
  it('groups models by provider preserving order', () => {
    const groups = groupModelsByProvider(models);
    expect(groups.map((group) => group.provider)).toEqual(['anthropic', 'openai', 'google']);
    expect(groups[0]?.models.map((model) => model.id)).toEqual(['claude-a', 'claude-b']);
    expect(groups[1]?.models).toHaveLength(1);
  });

  it('returns empty groups for an empty registry', () => {
    expect(groupModelsByProvider([])).toEqual([]);
  });
});
