// Trusted live-eval environment import. No shell evaluation, files or credential creation.
import { parseEnv } from 'node:util';
const allowed = [
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL',
  'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'OPENROUTER_API_KEY',
  'LONGBRIDGE_APP_KEY', 'LONGBRIDGE_APP_SECRET', 'LONGBRIDGE_ACCESS_TOKEN', 'LONGBRIDGE_REGION',
  'FINAGENT_JUDGE_API_KEY', 'FINAGENT_JUDGE_BASE_URL', 'FINAGENT_JUDGE_HEADERS',
  'LANGSMITH_PI_API_KEY', 'LANGSMITH_API_KEY', 'LANGSMITH_PI_ENDPOINT', 'LANGSMITH_PI_PROJECT',
];
export function liveEvalEnvironment(source, judgeProvider) {
  let values;
  try { values = parseEnv(source.FINAGENT_ENV_FILE_CONTENT || ''); }
  catch { throw new Error('Invalid FINAGENT_ENV_FILE_CONTENT; contents suppressed'); }
  if (source.FINAGENT_DEMO_DATA === '1' || values.FINAGENT_DEMO_DATA === '1') {
    throw new Error('Live evaluation cannot use demo data');
  }
  const env = { ...source };
  delete env.FINAGENT_ENV_FILE_CONTENT;
  for (const key of Object.keys(env)) if (/^(APPLE_|CSC_|WIN_CSC_)/.test(key)) delete env[key];
  for (const key of allowed) {
    const value = source[key]?.trim() ? source[key] : values[key];
    if (value?.trim()) env[key] = value;
    else delete env[key];
  }
  // Match the existing nightly's Anthropic judge credential alias after dotenv import.
  // No cross-provider fallback is attempted: an absent/unknown judge key stays absent.
  if (!env.FINAGENT_JUDGE_API_KEY && judgeProvider?.toLowerCase().startsWith('anthropic') && env.ANTHROPIC_API_KEY) {
    env.FINAGENT_JUDGE_API_KEY = env.ANTHROPIC_API_KEY;
  }
  return env;
}
