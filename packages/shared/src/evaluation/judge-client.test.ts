import { describe, expect, it } from 'bun:test';
import { resolveJudgeConfig, resolveJudgeConfigStatus } from './judge-client.ts';

describe('judge config normalization', () => {
  it('treats a whitespace-only API key as missing at preflight', () => {
    const status = resolveJudgeConfigStatus({
      FINAGENT_JUDGE_PROVIDER: 'anthropic',
      FINAGENT_JUDGE_MODEL: 'claude-sonnet-4',
      FINAGENT_JUDGE_API_KEY: '   ',
    });

    expect(status.requested).toBe(true);
    expect(status.missing).toEqual(['API key (--judge-api-key / FINAGENT_JUDGE_API_KEY)']);
    expect(status.config).toBeUndefined();
  });

  it('resolves the provider the preflight promised when the value carries whitespace', () => {
    const env: NodeJS.ProcessEnv = {
      FINAGENT_JUDGE_PROVIDER: ' anthropic\n',
      FINAGENT_JUDGE_MODEL: 'claude-sonnet-4',
      FINAGENT_JUDGE_API_KEY: 'k',
    };

    expect(resolveJudgeConfigStatus(env).missing).toEqual([]);
    expect(resolveJudgeConfigStatus(env).config?.provider).toBe('anthropic');
    expect(resolveJudgeConfig(env)?.provider).toBe('anthropic');
  });

  it('hands trimmed model and API key to the client', () => {
    const config = resolveJudgeConfig({
      FINAGENT_JUDGE_PROVIDER: 'openai-compatible',
      FINAGENT_JUDGE_MODEL: ' gpt-4o ',
      FINAGENT_JUDGE_API_KEY: ' sk-test\n',
    });

    expect(config).toMatchObject({ provider: 'openai-compatible', model: 'gpt-4o', apiKey: 'sk-test' });
  });

  it('names every missing setting when the configuration is incomplete', () => {
    const status = resolveJudgeConfigStatus({ FINAGENT_JUDGE_MODEL: 'gpt-4o' });

    expect(status.requested).toBe(true);
    expect(status.config).toBeUndefined();
    expect(status.missing).toEqual([
      'provider (--judge-provider / FINAGENT_JUDGE_PROVIDER)',
      'API key (--judge-api-key / FINAGENT_JUDGE_API_KEY)',
    ]);
  });

  it('reports "not requested" when every value is blank', () => {
    const status = resolveJudgeConfigStatus({
      FINAGENT_JUDGE_PROVIDER: '  ',
      FINAGENT_JUDGE_MODEL: '',
      FINAGENT_JUDGE_API_KEY: '   ',
    });

    expect(status.requested).toBe(false);
    expect(status.missing).toEqual([]);
    expect(status.config).toBeUndefined();
  });

  it('keeps the preflight verdict and the resolved config in agreement', () => {
    const cases: NodeJS.ProcessEnv[] = [
      { FINAGENT_JUDGE_PROVIDER: 'anthropic', FINAGENT_JUDGE_MODEL: 'claude', FINAGENT_JUDGE_API_KEY: 'k' },
      { FINAGENT_JUDGE_PROVIDER: ' anthropic ', FINAGENT_JUDGE_MODEL: ' claude ', FINAGENT_JUDGE_API_KEY: ' k ' },
      { FINAGENT_JUDGE_PROVIDER: 'openai-compatible', FINAGENT_JUDGE_MODEL: 'gpt-4o', FINAGENT_JUDGE_API_KEY: '   ' },
      { FINAGENT_JUDGE_PROVIDER: '', FINAGENT_JUDGE_MODEL: 'claude', FINAGENT_JUDGE_API_KEY: 'k' },
      { FINAGENT_JUDGE_PROVIDER: 'anthropic\n', FINAGENT_JUDGE_MODEL: '\tclaude', FINAGENT_JUDGE_API_KEY: 'k\n' },
    ];

    for (const env of cases) {
      const status = resolveJudgeConfigStatus(env);
      // A clean preflight must always hand over a usable config, and an
      // incomplete one must never do so.
      expect(status.config !== undefined).toBe(status.requested && status.missing.length === 0);
    }
  });

  it('prefers an explicit override over a blank env value', () => {
    const status = resolveJudgeConfigStatus({ FINAGENT_JUDGE_PROVIDER: '  ' }, { provider: 'anthropic', model: 'claude', apiKey: 'k' });

    expect(status.missing).toEqual([]);
    expect(status.config).toMatchObject({ provider: 'anthropic', model: 'claude', apiKey: 'k' });
  });
});
