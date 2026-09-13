import type { EvaluationSettings, PrivacyLevel } from '@finagent/core';
import { NoopEvaluationBackend, type EvaluationBackend, type FetchLike } from '../backend.ts';
import { LangfuseEvaluationBackend, langfuseCredentialsFromEnv, parseLangfuseCredential } from './backend.ts';

export interface ResolveLangfuseInput {
  settings: Pick<EvaluationSettings, 'langfuseTracingEnabled' | 'langfuseHost' | 'privacyLevel'> & {
    tracingEnabled?: boolean;
  };
  /** JSON or public|secret blob from CredentialStore provider `langfuse`. */
  storedCredential?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: FetchLike;
  privacyLevel?: PrivacyLevel;
}

/**
 * Build a Langfuse backend when tracing is enabled and credentials exist.
 * Returns Noop otherwise — never throws.
 */
export function resolveLangfuseBackend(input: ResolveLangfuseInput): EvaluationBackend {
  const env = input.env ?? process.env;
  const enabled = input.settings.langfuseTracingEnabled === true
    || env.LANGFUSE_TRACING === 'true'
    || env.LANGFUSE_TRACING === '1'
    || env.LANGFUSE_TRACING === 'yes'
    || env.LANGFUSE_TRACING === 'on';
  if (!enabled) return new NoopEvaluationBackend();
  const fromStore = parseLangfuseCredential(input.storedCredential);
  const fromEnv = langfuseCredentialsFromEnv(env);
  const creds = fromStore ?? (fromEnv ? { publicKey: fromEnv.publicKey, secretKey: fromEnv.secretKey } : undefined);
  if (!creds) return new NoopEvaluationBackend();
  try {
    return new LangfuseEvaluationBackend({
      publicKey: creds.publicKey,
      secretKey: creds.secretKey,
      host: input.settings.langfuseHost || fromEnv?.host,
      fetchImpl: input.fetchImpl,
      privacyLevel: input.privacyLevel ?? input.settings.privacyLevel,
    });
  } catch {
    return new NoopEvaluationBackend();
  }
}
