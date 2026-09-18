// Judge LLM client (spec §80).
//
// The judge model is configured separately from the agent under test. This
// module provides a thin provider-neutral client used by the LLM judges and
// the experiment runner. Judge calls happen in the main process / CLI, never
// in the Pi runtime, and never on the agent's critical path.
import { createCodeError } from '../agent/errors.ts';
import type { FetchLike } from './backend.ts';

export interface JudgeMessage {
  role: 'system' | 'user';
  content: string;
}

export interface JudgeClient {
  readonly provider: string;
  readonly model: string;
  /** Returns the raw completion text; throws on transport/API failure. */
  complete(system: string, user: string, signal?: AbortSignal): Promise<string>;
}

export interface JudgeClientOptions {
  provider: 'anthropic' | 'openai-compatible';
  model: string;
  apiKey: string;
  baseUrl?: string;
  /**
   * Extra HTTP headers merged over the provider defaults — relays/gateways
   * that require routing or session headers (e.g. `x-opencode-session`).
   */
  headers?: Record<string, string>;
  fetchImpl?: FetchLike;
}

const ANTHROPIC_DEFAULT = 'https://api.anthropic.com/v1/messages';

function buildHeaders(options: JudgeClientOptions): Record<string, string> {
  const providerHeaders: Record<string, string> =
    options.provider === 'anthropic'
      ? {
          'x-api-key': options.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        }
      : {
          authorization: `Bearer ${options.apiKey}`,
          'content-type': 'application/json',
        };
  return { ...providerHeaders, ...(options.headers ?? {}) };
}

function buildBody(options: JudgeClientOptions, system: string, user: string): Record<string, unknown> {
  const temperature = 0;
  if (options.provider === 'anthropic') {
    return {
      model: options.model,
      max_tokens: 4096,
      temperature,
      system,
      messages: [{ role: 'user', content: user }],
    };
  }
  return {
    model: options.model,
    temperature,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  };
}

function extractText(payload: Record<string, unknown>): string {
  const choices = payload.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const choice = choices[0] as Record<string, unknown>;
    const message = choice.message as Record<string, unknown> | undefined;
    if (message && typeof message.content === 'string') return message.content;
    const text = choice.text;
    if (typeof text === 'string') return text;
  }
  const content = payload.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content) && content.length > 0) {
    const block = content[0] as Record<string, unknown>;
    if (typeof block.text === 'string') return block.text;
  }
  throw createCodeError('JUDGE_PARSE_ERROR', 'Judge provider returned an unrecognized completion payload.');
}

export function createJudgeClient(options: JudgeClientOptions): JudgeClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.provider === 'anthropic'
    ? options.baseUrl?.replace(/\/+$/, '') ?? ANTHROPIC_DEFAULT
    : options.baseUrl?.replace(/\/+$/, '') ?? 'https://api.openai.com/v1';
  const url = options.provider === 'anthropic' ? baseUrl : `${baseUrl}/chat/completions`;

  return {
    provider: options.provider,
    model: options.model,
    async complete(system: string, user: string, signal?: AbortSignal): Promise<string> {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: buildHeaders(options),
        body: JSON.stringify(buildBody(options, system, user)),
        signal,
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw createCodeError(
          'JUDGE_API_ERROR',
          `Judge provider ${options.provider} returned ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}.`
        );
      }
      const payload = (await response.json()) as Record<string, unknown>;
      return extractText(payload);
    },
  };
}

export interface ResolvedJudgeConfig extends JudgeClientOptions {}

/** Parse FINAGENT_JUDGE_HEADERS (JSON object of string→string); invalid input is ignored. */
function parseJudgeHeaders(raw: string | undefined): Record<string, string> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const entries = Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  } catch {
    return undefined;
  }
}

export interface JudgeConfigResolution {
  /** True when any judge setting is present (flags or env) — i.e. a judge is expected. */
  requested: boolean;
  config?: ResolvedJudgeConfig;
  /** Required settings still missing, named for the user (never their values). */
  missing: string[];
}

/**
 * Like {@link resolveJudgeConfig}, but distinguishes "no judge requested" from
 * "judge requested but misconfigured". The live preflight (issue #113) needs
 * the latter to be an explicit failure rather than a silent deterministic-only
 * downgrade.
 */
export function resolveJudgeConfigStatus(
  env: NodeJS.ProcessEnv,
  explicit?: { provider?: string; model?: string; apiKey?: string; baseUrl?: string },
): JudgeConfigResolution {
  const provider = (explicit?.provider ?? env.FINAGENT_JUDGE_PROVIDER ?? '').trim();
  const model = (explicit?.model ?? env.FINAGENT_JUDGE_MODEL ?? '').trim();
  const apiKey = explicit?.apiKey ?? env.FINAGENT_JUDGE_API_KEY ?? '';
  const requested = provider.length > 0 || model.length > 0 || apiKey.length > 0;
  if (!requested) return { requested: false, missing: [] };

  const missing: string[] = [];
  if (provider.length === 0) missing.push('provider (--judge-provider / FINAGENT_JUDGE_PROVIDER)');
  if (model.length === 0) missing.push('model (--judge-model / FINAGENT_JUDGE_MODEL)');
  if (apiKey.length === 0) missing.push('API key (--judge-api-key / FINAGENT_JUDGE_API_KEY)');
  if (missing.length > 0) return { requested: true, missing };

  return { requested: true, config: resolveJudgeConfig(env, explicit), missing: [] };
}

/**
 * Resolve judge credentials from env with FINAGENT_JUDGE_* taking precedence,
 * then provider-specific fallbacks. Never reads secrets from files — the
 * caller (main process) supplies them from safeStorage where applicable.
 */
export function resolveJudgeConfig(
  env: NodeJS.ProcessEnv,
  explicit?: { provider?: string; model?: string; apiKey?: string; baseUrl?: string; headers?: Record<string, string> },
): ResolvedJudgeConfig | undefined {
  const provider = (explicit?.provider ?? env.FINAGENT_JUDGE_PROVIDER ?? '').toLowerCase();
  const model = explicit?.model ?? env.FINAGENT_JUDGE_MODEL;
  const apiKey = explicit?.apiKey ?? env.FINAGENT_JUDGE_API_KEY;
  if (!provider || !model || !apiKey) return undefined;
  const headers = explicit?.headers ?? parseJudgeHeaders(env.FINAGENT_JUDGE_HEADERS);
  const extra = headers ? { headers } : {};

  if (provider.startsWith('anthropic')) {
    return {
      provider: 'anthropic',
      model,
      apiKey,
      baseUrl: explicit?.baseUrl ?? env.FINAGENT_JUDGE_BASE_URL ?? env.ANTHROPIC_BASE_URL,
      ...extra,
    };
  }
  return {
    provider: 'openai-compatible',
    model,
    apiKey,
    baseUrl: explicit?.baseUrl ?? env.FINAGENT_JUDGE_BASE_URL ?? env.OPENAI_BASE_URL,
    ...extra,
  };
}