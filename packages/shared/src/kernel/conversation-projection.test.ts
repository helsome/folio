import { describe, expect, it } from 'bun:test';
import type { ConversationBranch, Message } from '@finagent/core';
import { materializeBranchMessages } from './conversation-projection.ts';

const main: ConversationBranch = {
  id: 'main',
  sessionId: 's1',
  name: 'Main',
  createdAt: 1,
  updatedAt: 1,
};

const alternative: ConversationBranch = {
  id: 'alternative',
  sessionId: 's1',
  name: 'Alternative',
  createdAt: 2,
  updatedAt: 2,
  parentBranchId: 'main',
  forkMessageId: 'm2',
};

const messages: Message[] = [
  { id: 'm1', role: 'user', content: 'first', timestamp: 1, branchId: 'main' },
  { id: 'm2', role: 'assistant', content: 'first answer', timestamp: 2, branchId: 'main' },
  { id: 'm3', role: 'user', content: 'second', timestamp: 3, branchId: 'main' },
  { id: 'm4', role: 'assistant', content: 'second answer', timestamp: 4, branchId: 'main' },
  { id: 'm5', role: 'assistant', content: 'alternative answer', timestamp: 5, branchId: 'alternative' },
];

describe('materializeBranchMessages', () => {
  it('inherits only the parent prefix through the fork cursor', () => {
    expect(materializeBranchMessages(messages, [main, alternative], 'alternative').map((message) => message.id))
      .toEqual(['m1', 'm2', 'm5']);
  });

  it('maps pre-branch legacy messages to Main', () => {
    const legacy = messages.map(({ branchId: _branchId, ...message }) => message);
    expect(materializeBranchMessages(legacy, [main], 'main').map((message) => message.id))
      .toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
  });

  it('rejects cyclic branch metadata', () => {
    const cyclic: ConversationBranch[] = [
      { ...main, parentBranchId: 'alternative' },
      alternative,
    ];
    expect(() => materializeBranchMessages(messages, cyclic, 'main')).toThrow('cycle');
  });
});
