import { afterEach, describe, expect, it } from 'bun:test';
import { createCapabilityTools as buildCapabilityTools, fullCapabilities } from '@finagent/shared/capabilities';
import { createCapabilityTools, readPrivacyLevelEnv, wrapToolsWithPrivacy, type Tool } from './index.ts';

const PORTFOLIO_TEXT = 'Portfolio overview\n\nDATA: {"holdings":[{"symbol":"AAPL","qty":10}],"cash":123456.78}';
const QUOTE_TEXT = 'Quote\n\nDATA: {"price": 432.1}';

function stubPortfolioTool(): Tool {
  return {
    name: 'get_portfolio',
    label: 'Portfolio',
    description: 'Account portfolio',
    parameters: {},
    async execute(_toolCallId, _params, _signal) {
      return { content: [{ type: 'text', text: PORTFOLIO_TEXT }] };
    },
  };
}

function stubQuoteTool(): Tool {
  return {
    name: 'get_quote',
    label: 'Quote',
    description: 'Market quote',
    parameters: {},
    async execute(_toolCallId, _params, _signal) {
      return { content: [{ type: 'text', text: QUOTE_TEXT }] };
    },
  };
}

const SAVED_ENV = process.env.FINAGENT_PRIVACY_LEVEL;

afterEach(() => {
  if (SAVED_ENV === undefined) delete process.env.FINAGENT_PRIVACY_LEVEL;
  else process.env.FINAGENT_PRIVACY_LEVEL = SAVED_ENV;
});

describe('readPrivacyLevelEnv', () => {
  it('reads minimal/standard/full from FINAGENT_PRIVACY_LEVEL', () => {
    expect(readPrivacyLevelEnv({ FINAGENT_PRIVACY_LEVEL: 'minimal' })).toBe('minimal');
    expect(readPrivacyLevelEnv({ FINAGENT_PRIVACY_LEVEL: 'standard' })).toBe('standard');
    expect(readPrivacyLevelEnv({ FINAGENT_PRIVACY_LEVEL: 'full' })).toBe('full');
  });

  it('trims and lowercases the value', () => {
    expect(readPrivacyLevelEnv({ FINAGENT_PRIVACY_LEVEL: '  FULL  ' })).toBe('full');
  });

  it('returns undefined when unset, empty, or unknown', () => {
    expect(readPrivacyLevelEnv({})).toBeUndefined();
    expect(readPrivacyLevelEnv({ FINAGENT_PRIVACY_LEVEL: '' })).toBeUndefined();
    expect(readPrivacyLevelEnv({ FINAGENT_PRIVACY_LEVEL: 'maximum' })).toBeUndefined();
  });
});

describe('wrapToolsWithPrivacy', () => {
  it('redacts portfolio DATA at standard, keeps the summary', async () => {
    const tools = wrapToolsWithPrivacy([stubPortfolioTool(), stubQuoteTool()], 'standard');
    const portfolioOut = await tools[0].execute('c1', {}, new AbortController().signal);
    expect(portfolioOut.content[0].text).toContain('Portfolio overview');
    expect(portfolioOut.content[0].text).toContain('[Finagent privacy level standard: portfolio details redacted]');
    expect(portfolioOut.content[0].text).not.toContain('AAPL');
    expect(portfolioOut.content[0].text).not.toContain('123456');
    expect(portfolioOut.content[0].text).not.toContain('DATA:');
  });

  it('redacts portfolio DATA at minimal the same way', async () => {
    const tools = wrapToolsWithPrivacy([stubPortfolioTool()], 'minimal');
    const out = await tools[0].execute('c1', {}, new AbortController().signal);
    expect(out.content[0].text).toContain('[Finagent privacy level minimal: portfolio details redacted]');
    expect(out.content[0].text).not.toContain('AAPL');
    expect(out.content[0].text).not.toContain('DATA:');
  });

  it('leaves non-portfolio tools untouched', async () => {
    const tools = wrapToolsWithPrivacy([stubQuoteTool()], 'standard');
    const out = await tools[0].execute('c1', {}, new AbortController().signal);
    expect(out.content[0].text).toBe(QUOTE_TEXT);
  });

  it('leaves tools untouched at full and when the level is undefined', () => {
    const tool = stubPortfolioTool();
    for (const level of ['full', undefined] as const) {
      const wrapped = wrapToolsWithPrivacy([tool], level);
      expect(wrapped[0].execute).toBe(tool.execute);
    }
  });

  it('recognizes capability-id style names starting with portfolio.', async () => {
    const tool: Tool = { ...stubPortfolioTool(), name: 'portfolio.summary' };
    const [wrapped] = wrapToolsWithPrivacy([tool], 'standard');
    const out = await wrapped.execute('c1', {}, new AbortController().signal);
    expect(out.content[0].text).toContain('portfolio details redacted');
  });

  it('preserves abort handling: passes the caller signal through and propagates rejection', async () => {
    const controller = new AbortController();
    const seen: AbortSignal[] = [];
    const tool: Tool = {
      ...stubPortfolioTool(),
      async execute(_toolCallId, _params, signal) {
        seen.push(signal);
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        return { content: [{ type: 'text', text: PORTFOLIO_TEXT }] };
      },
    };
    const [wrapped] = wrapToolsWithPrivacy([tool], 'standard');
    controller.abort();
    await expect(wrapped.execute('c1', {}, controller.signal)).rejects.toThrow('Aborted');
    expect(seen[0]).toBe(controller.signal);
  });
});

function portfolioExecute(env: NodeJS.ProcessEnv): Tool['execute'] {
  const tool = createCapabilityTools(env).find((t) => t.name === 'get_portfolio');
  expect(tool).toBeDefined();
  return tool!.execute;
}

describe('createCapabilityTools env wiring', () => {
  // createCapabilityTools(env) reads FINAGENT_PRIVACY_LEVEL from the given
  // env per call, so each variant is testable without re-importing the
  // module (cache-busted dynamic imports corrupt bun's module registry in
  // parallel test workers — see V7 integration notes).

  it('wraps portfolio tools when FINAGENT_PRIVACY_LEVEL=standard or minimal', () => {
    expect(portfolioExecute({ FINAGENT_PRIVACY_LEVEL: 'standard' }).toString()).toContain(
      'portfolio details redacted'
    );
    expect(portfolioExecute({ FINAGENT_PRIVACY_LEVEL: 'minimal' }).toString()).toContain(
      'portfolio details redacted'
    );
  });

  it('does not wrap when FINAGENT_PRIVACY_LEVEL is unset', () => {
    expect(portfolioExecute({}).toString()).not.toContain('portfolio details redacted');
  });

  it('does not wrap when the level is unknown or full', () => {
    expect(portfolioExecute({ FINAGENT_PRIVACY_LEVEL: 'bogus' }).toString()).not.toContain(
      'portfolio details redacted'
    );
    expect(portfolioExecute({ FINAGENT_PRIVACY_LEVEL: 'full' }).toString()).not.toContain(
      'portfolio details redacted'
    );
  });

  it('raw capability executes never carry the privacy notice literal', () => {
    const raw = buildCapabilityTools(fullCapabilities);
    const rawPortfolio = raw.find((tool) => tool.name === 'get_portfolio')!;
    expect(rawPortfolio.execute.toString()).not.toContain('portfolio details redacted');
  });
});

describe('contract predicate scope', () => {
  it('wraps every portfolio-family tool name (get_portfolio, get_positions, get_assets, get_cash_flow)', async () => {
    for (const name of ['get_portfolio', 'get_positions', 'get_assets', 'get_cash_flow']) {
      const tool: Tool = { ...stubPortfolioTool(), name };
      const [wrapped] = wrapToolsWithPrivacy([tool], 'standard');
      const out = await wrapped.execute('c1', {}, new AbortController().signal);
      expect(out.content[0].text).toContain('portfolio details redacted');
    }
  });

  it('leaves non-portfolio tools (get_quote) raw', async () => {
    const tool: Tool = { ...stubQuoteTool(), name: 'get_quote' };
    const [wrapped] = wrapToolsWithPrivacy([tool], 'standard');
    const out = await wrapped.execute('c1', {}, new AbortController().signal);
    expect(out.content[0].text).toBe(QUOTE_TEXT);
  });
});