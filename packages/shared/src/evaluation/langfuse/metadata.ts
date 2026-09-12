// Folio ↔ Langfuse metadata / tag contract (issue #14).
//
// Tags are the filterable axis in the Langfuse UI; metadata is the structured
// payload attached to the root trace. Keep both stable so evaluation runs,
// gold cases, and production Copilot runs can be sliced without parsing
// free-text names.

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
  model?: string;
  provider?: string;
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
