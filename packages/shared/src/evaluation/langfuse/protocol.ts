// Langfuse public ingestion protocol (v3 batch API).
//
// We talk REST directly so tests can drive a mock server and the agent path
// never depends on an SDK constructor. See:
// https://langfuse.com/docs/observability/sdk/overview

export type LangfuseIngestionType =
  | 'trace-create'
  | 'span-create'
  | 'generation-create'
  | 'score-create';

export type LangfuseObservationLevel = 'DEBUG' | 'DEFAULT' | 'WARNING' | 'ERROR';

export interface LangfuseIngestionEvent {
  id: string;
  type: LangfuseIngestionType;
  timestamp: string;
  body: Record<string, unknown>;
}

export interface LangfuseScoreInput {
  name: string;
  value: number;
  comment?: string;
  dataType?: 'NUMERIC' | 'BOOLEAN' | 'CATEGORICAL';
}

export interface LangfuseIngestionResult {
  ok: boolean;
  traceId?: string;
  error?: string;
}

export function isoFromEpoch(ms: number): string {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

export function newEventId(): string {
  return crypto.randomUUID();
}
