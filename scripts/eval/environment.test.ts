import { describe, expect, it } from 'bun:test';
import { liveEvalEnvironment } from './environment.mjs';
import { longbridgeSetupAllowed } from '../release-provider.mjs';
import { resolveJudgeConfigStatus } from '../../packages/shared/src/evaluation/judge-client.ts';

describe('live evaluation environment', () => {
  const content = 'ANTHROPIC_API_KEY=fake-anthropic\nLONGBRIDGE_APP_KEY=fake-app\nLONGBRIDGE_APP_SECRET=fake-secret\nLONGBRIDGE_ACCESS_TOKEN=fake-access\nNODE_OPTIONS=malicious\nFINAGENT_PI_COMMAND=malicious\nPATH=/malicious';
  it('loads only supported fields from the existing secret and fills the Anthropic judge alias', () => {
    const result = liveEvalEnvironment({ FINAGENT_ENV_FILE_CONTENT: content, ANTHROPIC_API_KEY: '', FINAGENT_JUDGE_API_KEY: '', PATH: '/real' }, 'anthropic');
    expect(result.ANTHROPIC_API_KEY).toBe('fake-anthropic');
    expect(result.LONGBRIDGE_ACCESS_TOKEN).toBe('fake-access');
    expect(result.FINAGENT_JUDGE_API_KEY).toBe('fake-anthropic');
    expect(result.FINAGENT_ENV_FILE_CONTENT).toBeUndefined();
    expect(result.NODE_OPTIONS).toBeUndefined();
    expect(result.FINAGENT_PI_COMMAND).toBeUndefined();
    expect(result.PATH).toBe('/real');
    expect(resolveJudgeConfigStatus(result, { provider: 'anthropic', model: 'test-model' }).requested).toBe(true);
    expect(resolveJudgeConfigStatus(result, { provider: 'anthropic', model: 'test-model' }).missing).toEqual([]);
  });
  it('preserves explicit nonempty environment values and a separate judge credential', () => {
    const result = liveEvalEnvironment({ FINAGENT_ENV_FILE_CONTENT: content, ANTHROPIC_API_KEY: 'explicit-fixture', FINAGENT_JUDGE_API_KEY: 'judge-fixture' }, 'anthropic');
    expect(result.ANTHROPIC_API_KEY).toBe('explicit-fixture');
    expect(result.FINAGENT_JUDGE_API_KEY).toBe('judge-fixture');
  });
  it('does not invent credentials or use an Anthropic key for another judge provider', () => {
    const empty = liveEvalEnvironment({ ANTHROPIC_API_KEY: '', FINAGENT_JUDGE_API_KEY: '' }, 'anthropic');
    expect(empty.ANTHROPIC_API_KEY).toBeUndefined();
    expect(empty.FINAGENT_JUDGE_API_KEY).toBeUndefined();
    expect(resolveJudgeConfigStatus(empty, { provider: 'anthropic', model: 'test-model' }).config).toBeUndefined();
    expect(liveEvalEnvironment({ FINAGENT_ENV_FILE_CONTENT: content }, 'openai-compatible').FINAGENT_JUDGE_API_KEY).toBeUndefined();
  });
  it('removes Apple signing material and rejects demo data from shell or secret', () => {
    expect(liveEvalEnvironment({ APPLE_CERTIFICATE_BASE64: 'private-fixture', CSC_LINK: 'private-fixture' }, 'anthropic')).toEqual({});
    expect(() => liveEvalEnvironment({ FINAGENT_DEMO_DATA: '1' }, 'anthropic')).toThrow('demo data');
    expect(() => liveEvalEnvironment({ FINAGENT_ENV_FILE_CONTENT: 'FINAGENT_DEMO_DATA=1' }, 'anthropic')).toThrow('demo data');
  });
});

describe('pinned Longbridge setup trust boundary', () => {
  it('allows main scheduled/manual eval and version-tag push/manual release only', () => {
    expect(longbridgeSetupAllowed({ FOLIO_LIVE_EVAL: '1', GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'schedule' })).toBe(true);
    expect(longbridgeSetupAllowed({ FOLIO_LIVE_EVAL: '1', GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'workflow_dispatch' })).toBe(true);
    expect(longbridgeSetupAllowed({ FOLIO_RELEASE_GATES: '1', GITHUB_REF: 'refs/tags/v0.4.0-beta.3', GITHUB_EVENT_NAME: 'push' })).toBe(true);
    expect(longbridgeSetupAllowed({ FOLIO_LIVE_EVAL: '1', GITHUB_REF: 'refs/heads/feature', GITHUB_EVENT_NAME: 'workflow_dispatch' })).toBe(false);
    expect(longbridgeSetupAllowed({ FOLIO_LIVE_EVAL: '1', GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'pull_request' })).toBe(false);
    expect(longbridgeSetupAllowed({ FOLIO_RELEASE_GATES: '1', GITHUB_REF: 'refs/tags/v0.4.0-beta.3', GITHUB_EVENT_NAME: 'pull_request_target' })).toBe(false);
  });
});
