import type { ApiResult } from '@finagent/core';
import type { FinagentClient } from '../client';

/**
 * Renderer-facing mirror of the `@finagent/shared/diagnostics` bundle shape.
 *
 * Kept here (like `CapabilityMetadata` above) so the renderer never imports
 * the shared package — which drags in node/executor code. The main process
 * owns the canonical shape; keep these two in sync.
 */

export interface DiagnosticsErrorEntry {
  at: number;
  source: string | null;
  message: string;
  stack: string | null;
}

export interface DiagnosticsFinancialProvider {
  id: string;
  status: string;
  coverage: {
    capabilities: string[];
    markets: string[];
  };
}

export interface DiagnosticsBundle {
  collectedAt: string;
  app: {
    version: string;
    platform: {
      os: string;
      arch: string;
      electron: string | null;
    };
  };
  runtime: {
    agent: {
      providerId: string | null;
      state: string | null;
    };
  };
  providers: {
    llm: {
      id: string | null;
      model: string | null;
    };
    financial: DiagnosticsFinancialProvider[];
    broker: {
      connected: boolean;
      accountCount: number;
    };
    longbridgeCliVersion: string | null;
  };
  skills: {
    loaded: number;
  };
  capabilities: {
    available: string[];
  };
  resources: {
    dev: boolean;
    root: string;
  };
  errors: DiagnosticsErrorEntry[];
  redaction: {
    policy: string;
    applied: boolean;
  };
}

export interface DiagnosticsExportResult {
  canceled?: boolean;
  filePath?: string;
}

/** The diagnostics channel surface (wired by the Lead at integration). */
export interface DiagnosticsChannel {
  collect: () => Promise<ApiResult<DiagnosticsBundle>>;
  export: () => Promise<ApiResult<DiagnosticsExportResult>>;
}

function channel(client: FinagentClient): Partial<DiagnosticsChannel> {
  const diagnostics = (client as { diagnostics?: Partial<DiagnosticsChannel> }).diagnostics;
  return diagnostics ?? {};
}

/** Collect a diagnostics snapshot; returns null when the channel is absent/fails. */
export async function collectDiagnosticsSnapshot(
  client: FinagentClient
): Promise<DiagnosticsBundle | null> {
  const collect = channel(client).collect;
  if (typeof collect !== 'function') return null;
  try {
    const result = await collect();
    return result.ok ? result.data : null;
  } catch {
    return null;
  }
}

/** Trigger a main-process support-bundle export; returns null on absence/failure. */
export async function exportDiagnosticsBundle(
  client: FinagentClient
): Promise<DiagnosticsExportResult | null> {
  const exportFn = channel(client).export;
  if (typeof exportFn !== 'function') return null;
  try {
    const result = await exportFn();
    return result.ok ? result.data : null;
  } catch {
    return null;
  }
}
