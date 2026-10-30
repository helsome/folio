// Folio ↔ Langfuse metadata / tag contract (issue #14).
//
// Tags are the filterable axis in the Langfuse UI; metadata is the structured
// payload attached to the root trace. Keep both stable so evaluation runs,
// gold cases, and production Copilot runs can be sliced without parsing
// free-text names.

import type { RunManifest } from '@finagent/core';

export type LangfuseRunKind = 'normal' | 'evaluation';

export const LANGFUSE_DEFAULT_HOST = 'https://cloud.langfuse.com';
export const LANGFUSE_TRACE_NAME_AGENT = 'folio.agent_run';
export const LANGFUSE_TRACE_NAME_RESEARCH = 'folio.deep_research';

export interface FolioLangfuseMetadata {
  folioRunId: string;
  folioSessionId?: string;
  threadId?: string;
  runKind: LangfuseRunKind;
  goldCaseId?: string;
  datasetId?: string;
  datasetVersion?: string;
  /** Readback-confirmed model/provider; absent when the runtime stayed unknown (#114). */
  model?: string;
  provider?: string;
  /**
   * Requested model/provider (#114). Kept under their own names so an
   * unapplied request can never be read back as the model that actually ran;
   * they deliberately do not become `model:`/`provider:` tags.
   */
  requestedModel?: string;
  requestedProvider?: string;
  agentVersion?: string;
  folioVersion?: string;
  promptVersion?: string;
  strategyId?: string;
  symbol?: string;
  locale?: string;
}

export interface LangfuseCredentials {
  publicKey: string;
  secretKey: string;
  host: string;
}

const TAG_SAFE = /[^a-zA-Z0-9_.:@/-]+/g;

function tagValue(value: string | undefined, max = 80): string | undefined {
  if (!value) return undefined;
  const cleaned = value.trim().replace(TAG_SAFE, '-').slice(0, max);
  return cleaned.length > 0 ? cleaned : undefined;
}

/** Stable, filterable tags for a Folio run. */
export function langfuseTags(meta: FolioLangfuseMetadata): string[] {
  const tags = new Set<string>(['folio', `run_kind:${meta.runKind}`]);
  const gold = tagValue(meta.goldCaseId);
  if (gold) tags.add(`gold_case:${gold}`);
  const dataset = tagValue(meta.datasetId);
  const version = tagValue(meta.datasetVersion);
  if (dataset && version) tags.add(`dataset:${dataset}@${version}`);
  else if (dataset) tags.add(`dataset:${dataset}`);
  const model = tagValue(meta.model);
  if (model) tags.add(`model:${model}`);
  const provider = tagValue(meta.provider);
  if (provider) tags.add(`provider:${provider}`);
  const strategy = tagValue(meta.strategyId);
  if (strategy) tags.add(`strategy:${strategy}`);
  const agent = tagValue(meta.agentVersion);
  if (agent) tags.add(`agent:${agent}`);
  return [...tags];
}

export function langfuseMetadataRecord(meta: FolioLangfuseMetadata): Record<string, unknown> {
  const record: Record<string, unknown> = {
    folioRunId: meta.folioRunId,
    runKind: meta.runKind,
  };
  if (meta.folioSessionId) record.folioSessionId = meta.folioSessionId;
  if (meta.threadId) record.threadId = meta.threadId;
  if (meta.goldCaseId) record.goldCaseId = meta.goldCaseId;
  if (meta.datasetId) record.datasetId = meta.datasetId;
  if (meta.datasetVersion) record.datasetVersion = meta.datasetVersion;
  if (meta.model) record.model = meta.model;
  if (meta.provider) record.provider = meta.provider;
  if (meta.requestedModel) record.requestedModel = meta.requestedModel;
  if (meta.requestedProvider) record.requestedProvider = meta.requestedProvider;
  if (meta.agentVersion) record.agentVersion = meta.agentVersion;
  if (meta.folioVersion) record.folioVersion = meta.folioVersion;
  if (meta.promptVersion) record.promptVersion = meta.promptVersion;
  if (meta.strategyId) record.strategyId = meta.strategyId;
  if (meta.symbol) record.symbol = meta.symbol;
  if (meta.locale) record.locale = meta.locale;
  return record;
}

export function normalizeLangfuseHost(host: string | undefined): string {
  const trimmed = host?.trim();
  if (!trimmed) return LANGFUSE_DEFAULT_HOST;
  return trimmed.replace(/\/+$/, '');
}

/** Call-site context that is not part of the run manifest itself. */
export interface ManifestLangfuseExtras {
  /** Folio session id (the trace's `sessionId`). */
  sessionId?: string;
  /** Runtime/Pi session id (the trace's `threadId`). */
  threadId?: string;
  /** Overrides the kind derived from the manifest's evaluation context. */
  runKind?: LangfuseRunKind;
  /** Instrument symbol, when the run targeted one. */
  symbol?: string;
  /**
   * Runtime config confirmed by READBACK (#114). When supplied it wins over the
   * manifest value, so a caller with fresher evidence is never overridden.
   */
  model?: string;
  provider?: string;
  /** Requested (not confirmed) values, recorded under their own names. */
  requestedModel?: string;
  requestedProvider?: string;
}

/**
 * Derive the Langfuse trace metadata from a run's immutable manifest (#21 ↔ #14).
 *
 * This is the single place the two identities are joined: the manifest's
 * `runId` becomes `folioRunId`, which the exporter also uses as the Langfuse
 * trace id, so a trace and its local manifest can always be matched. The
 * manifest's captured config (model, provider, strategy, prompt version, gold
 * case / dataset) fills the metadata fields the old hand-rolled call sites
 * omitted.
 *
 * Only readback-confirmed values become `model`/`provider`; a manifest records
 * the model that actually ran, so it is safe to promote.
 */
export function manifestToLangfuseMetadata(
  manifest: RunManifest,
  extras: ManifestLangfuseExtras = {}
): FolioLangfuseMetadata {
  const evaluation = manifest.evaluation;
  const runKind: LangfuseRunKind =
    extras.runKind ?? (evaluation ? 'evaluation' : 'normal');
  return {
    folioRunId: manifest.runId,
    folioSessionId: extras.sessionId,
    threadId: extras.threadId,
    runKind,
    goldCaseId: evaluation?.caseId,
    datasetId: evaluation?.datasetId,
    datasetVersion: evaluation?.datasetVersion,
    model: extras.model ?? manifest.model,
    provider: extras.provider ?? manifest.provider,
    requestedModel: extras.requestedModel,
    requestedProvider: extras.requestedProvider,
    agentVersion: manifest.strategy?.version,
    folioVersion: manifest.appVersion,
    promptVersion: manifest.prompt?.version,
    strategyId: manifest.strategy?.id,
    symbol: extras.symbol,
    locale: manifest.locale,
  };
}
