import type { CapabilityRegistry } from '@finagent/core';

/**
 * Diagnostics domain (spec §35–36).
 *
 * Every shape here is JSON-stable: optional fields are `string | null` (never
 * `undefined`), so a collected bundle survives `JSON.stringify` →
 * `JSON.parse` unchanged. No secret material is ever represented here —
 * provider ids/models are the most identifying fields we keep; keys, tokens,
 * conversation contents, and portfolio details are excluded by construction.
 */

/** One entry in the last-errors ring buffer (already redacted at push time). */
export interface ErrorLogEntry {
  /** Epoch ms the error was recorded. */
  at: number;
  /** Where the error originated: renderer | main | agent | longbridge. */
  source: string | null;
  /** User-safe message; raw vendor output is never retained. */
  message: string;
  /** Stack trace, already redacted. */
  stack: string | null;
}

/** Health/coverage summary for one financial/broker provider (spec §35). */
export interface FinancialProviderSummary {
  id: string;
  status: string;
  coverage: {
    capabilities: string[];
    markets: string[];
  };
}

/** Inputs the main-process collector gathers before assembling the bundle. */
export interface DiagnosticsInput {
  version: string;
  os: string;
  arch: string;
  electronVersion: string | null;
  agentProviderId: string | null;
  agentState: string | null;
  llmProviderId: string | null;
  llmModel: string | null;
  financialProviders: FinancialProviderSummary[];
  brokerConnected: boolean;
  brokerAccountCount: number;
  skillsLoadedCount: number;
  capabilities: CapabilityRegistry | null;
  resources: {
    dev: boolean;
    root: string;
  };
  errors: ErrorLogEntry[];
}

/** The collected diagnostics bundle (spec §35), JSON-stable, secret-free. */
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
    financial: FinancialProviderSummary[];
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
  errors: ErrorLogEntry[];
  redaction: {
    policy: string;
    applied: boolean;
  };
}
