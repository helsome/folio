import type { EvaluationSettings, PrivacyLevel } from '@finagent/core';
import { NoopEvaluationBackend, type EvaluationBackend, type FetchLike } from '../backend.ts';
import { LangfuseEvaluationBackend, isLangfuseTracingEnabled, langfuseCredentialsFromEnv, parseLangfuseCredential } from './backend.ts';

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
  // Single source of truth for the switch: `isLangfuseTracingEnabled` is the
  // exported, tested parser. Parsing `LANGFUSE_TRACING` again here (exact-match)
  // made the same env value mean two different things — `TRUE` / ` on ` turned
  // tracing on for the helper and off for every real backend.
  if (!isLangfuseTracingEnabled(input.settings, env)) return new NoopEvaluationBackend();
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
