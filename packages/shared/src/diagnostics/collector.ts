import { executeLongBridge } from '@finagent/longbridge-tools';
import { REDACTION_POLICY } from './redact.ts';
import type { DiagnosticsBundle, DiagnosticsInput, ErrorLogEntry } from './types.ts';

export interface CollectDiagnosticsOptions {
  /**
   * Injectable version probe for tests / alternate executors. Defaults to
   * `longbridge --version` with a short timeout. Must never throw — the
   * collector treats any failure as "version unknown".
   */
  fetchLongbridgeVersion?: () => Promise<string>;
}

const DEFAULT_TIMEOUT_MS = 5000;

function defaultFetchLongbridgeVersion(): Promise<string> {
  return executeLongBridge(['--version'], { timeout: DEFAULT_TIMEOUT_MS });
}

/**
 * Assemble a diagnostics bundle from main-process inputs (spec §35).
 *
 * Pure and JSON-stable: the result contains no `undefined` fields and no
 * secret material. The longbridge CLI version is probed best-effort; a
 * missing CLI, timeout, or auth error yields `null` rather than a rejection.
 */
export async function collectDiagnostics(
  input: DiagnosticsInput,
  options: CollectDiagnosticsOptions = {}
): Promise<DiagnosticsBundle> {
  const longbridgeCliVersion = await probeLongbridgeVersion(
    options.fetchLongbridgeVersion ?? defaultFetchLongbridgeVersion
  );

  return {
    collectedAt: new Date().toISOString(),
    app: {
      version: input.version,
      platform: {
        os: input.os,
        arch: input.arch,
        electron: input.electronVersion,
      },
    },
    runtime: {
      agent: {
        providerId: input.agentProviderId,
        state: input.agentState,
      },
    },
    providers: {
      llm: {
        id: input.llmProviderId,
        model: input.llmModel,
      },
      financial: input.financialProviders.map((provider) => ({
        id: provider.id,
        status: provider.status,
        coverage: {
          capabilities: [...provider.coverage.capabilities],
          markets: [...provider.coverage.markets],
        },
      })),
      broker: {
        connected: input.brokerConnected,
        accountCount: input.brokerAccountCount,
      },
      longbridgeCliVersion,
    },
    skills: {
      loaded: input.skillsLoadedCount,
    },
    capabilities: {
      available: input.capabilities ? input.capabilities.list().map((cap) => cap.id) : [],
    },
    evaluation: {
      backend: input.evaluation.backend,
      tracingEnabled: input.evaluation.tracingEnabled,
      privacyLevel: input.evaluation.privacyLevel,
      project: input.evaluation.project,
      connected: input.evaluation.connected,
      traceStatus: input.evaluation.traceStatus,
      datasets: [...input.evaluation.datasets],
    },
    resources: {
      dev: input.resources.dev,
      root: input.resources.root,
    },
    errors: input.errors.map(cloneErrorEntry),
    redaction: {
      policy: REDACTION_POLICY,
      applied: false,
    },
  };
}

async function probeLongbridgeVersion(fetch: () => Promise<string>): Promise<string | null> {
  try {
    const raw = await fetch();
    const trimmed = raw.trim();
    if (!trimmed) return null;
    // `longbridge 0.17.0` -> `0.17.0`; keep a bare semver if that's all we got.
    const match = trimmed.match(/\d+\.\d+\.\d+/);
    return match ? match[0] : trimmed;
  } catch {
    return null;
  }
}

function cloneErrorEntry(entry: ErrorLogEntry): ErrorLogEntry {
  return {
    at: entry.at,
    source: entry.source ?? null,
    message: entry.message,
    stack: entry.stack ?? null,
  };
}
