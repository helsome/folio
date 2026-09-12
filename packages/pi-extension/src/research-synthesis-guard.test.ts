import { expect, it } from 'bun:test';
import { registerResearchSynthesisGuard } from './index.ts';

it('blocks every synthesis tool and restores the copilot tool set afterwards', () => {
  const handlers = new Map<string, (event: { prompt?: string }) => unknown>();
  let tools = ['read', 'bash', 'write', 'get_quote'];
  registerResearchSynthesisGuard({
    registerTool() {},
    on: (event, handler) => { handlers.set(event, handler); },
    getActiveTools: () => tools,
    setActiveTools: (next) => { tools = next; },
  });
  handlers.get('before_agent_start')!({ prompt: 'Context\nUser request: [FOLIO_CHECKPOINT_SYNTHESIS_V1]\nFacts' });
  expect(tools).toEqual([]);
  expect(handlers.get('tool_call')!({})).toMatchObject({ block: true });
  handlers.get('agent_end')!({});
  expect(tools).toEqual(['read', 'bash', 'write', 'get_quote']);
  handlers.get('before_agent_start')!({ prompt: 'Look up NVDA.US' });
  expect(handlers.get('tool_call')!({})).toBeUndefined();
});
