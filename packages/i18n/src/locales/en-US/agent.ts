import type { NamespaceResource } from '../keys.ts';

/** Agent panel + chat chrome (spec §113). Lifetime values are runtime data, not chrome. */
export const agent = {
  panel: {
    collapsePanel: 'Collapse agent panel',
    inputPlaceholder: 'Ask the copilot…',
    inputRunningPlaceholder: 'Agent is running…',
    sendMessage: 'Send message',
    stop: 'Stop',
    agentRunning: 'Agent running',
    thinking: 'Thinking…',
  },
  empty: {
    body: 'Start a new session to explore markets with your agent.',
    createSession: 'Create New Session',
  },
  context: {
    none: 'No security context',
    clear: 'Clear security context',
  },
  model: {
    label: 'Model',
    loading: 'Loading models…',
    select: 'Select model',
    none: 'No models available',
  },
  reasoning: {
    label: 'Reasoning',
    withLevel: 'Reasoning: {{level}}',
    unavailable: 'Thinking levels unavailable in this runtime',
  },
  tool: {
    running: 'Working with market data',
    analyzedSources_one: 'Analyzed {{count}} source',
    analyzedSources_other: 'Analyzed {{count}} sources',
    statusRunning: 'running',
    label: 'Tool: {{name}}',
    calls: 'Tool calls',
  },
  quote: {
    title: 'Quote',
    open: 'Open',
    high: 'High',
    low: 'Low',
    prevClose: 'Prev close',
    volume: 'Volume',
    updated: 'Updated',
  },
  risk: {
    title: 'Portfolio risk',
    totalValue: 'Total Assets',
    cash: 'Cash',
    cashPct: 'Cash %',
    largestPosition: 'Largest position',
    largestWeight: 'Largest weight',
    positions: 'Positions',
  },
  chat: {
    noMessages: 'No messages yet. Start the conversation!',
  },
} satisfies NamespaceResource;
