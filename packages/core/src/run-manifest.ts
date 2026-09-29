/**
 * Immutable run manifest (#21).
 *
 * A manifest is a machine-readable snapshot of *everything that influenced a
 * single Agent / Deep Research run*: model + provider identity, the effective
 * model params, the system/developer prompt composition, the agent/workflow
 * strategy, the enabled tools, the search/retrieval provider + config, the
 * active feature flags / runtime mode, the budget, and the app/build identity.
 *
 * It is captured once when the run is created and is **never overwritten by
 * later global settings** — re-opening a historical run shows the manifest it
 * was born with, not today's configuration. Secrets/credentials are never
 * written into a manifest (see `redactManifestSecrets` in
 * `@finagent/shared`).
 */

/** Schema version for the manifest payload. Bump when the shape changes. */
export const RUN_MANIFEST_SCHEMA_VERSION = 1 as const;

/** Which agent runtime produced the run. */
export type RunManifestRuntimeMode = 'local' | 'pi' | 'demo';

/** Effective model identity for the run. */
export interface RunManifestIdentity {
  provider?: string;
  model?: string;
}

/** Model params that were actually in effect for the run. */
export interface RunManifestModelParams {
  /** Provider API kind, e.g. `openai-completions`. */
  api?: string;
  /** Resolved model base URL (no key — see redaction). */
  baseUrl?: string;
  /** Custom provider endpoint, when configured (no key). */
  endpoint?: string;
  /** Effective thinking/reasoning level. */
  thinkingLevel?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  /** Reserved for provider-specific sampling knobs (never secrets). */
  sampling?: Record<string, unknown>;
}

/** System/developer prompt composition, traced to its source. */
export interface RunManifestPrompt {
  /** Stable hash of the prompt composition (enabled skills + template). */
  hash: string;
  /** Human-readable template/version the prompt was built from. */
  version?: string;
  /** Where the prompt template came from, e.g. `skill-index`. */
  source?: string;
}

/** Agent / research workflow strategy that drove the run. */
export interface RunManifestStrategy {
  id?: string;
  version?: string;
}

/**
 * Workflow id for the interactive Copilot agent path. Deep Research runs use
 * the research strategy id (`StrategyId`) instead; both land in
 * `RunManifestStrategy.id` so the manifest always names the workflow that ran.
 */
export const AGENT_WORKFLOW_ID = 'copilot-agent';

/** One enabled tool captured in the manifest. */
export interface RunManifestTool {
  name: string;
  /** Capability id this tool is generated from, when known. */
  capability?: string;
  /** Tool/extension version, when known. */
  version?: string;
  enabled: boolean;
}

/** Search / retrieval provider config at run time. */
export interface RunManifestSearch {
  /** Primary financial-data provider id (e.g. `longbridge`). */
  providerId?: string;
  routing?: { primary?: string; fallback?: string };
  configured?: boolean;
  /** Provider endpoint (no key). */
  endpoint?: string;
}

/** Active feature flags / runtime mode toggles. */
export type RunManifestFeatureFlags = Record<string, boolean | string>;

/**
 * Budget that governed the run (#17). Records both what was *requested*
 * (defaults / per-run overrides / system ceiling) and what the run *actually
 * obeyed* (`effective`, after clamping) so a historical run can be explained
 * without re-deriving the resolution rules of the day.
 */
export interface RunManifestBudget {
  defaults?: Record<string, number>;
  ceiling?: Record<string, number>;
  overrides?: Record<string, number>;
  /** Effective limits the run obeyed: defaults/overrides clamped by the ceiling. */
  effective?: Record<string, number>;
  /** Budget keys whose requested value was cut down by the system ceiling. */
  clamped?: string[];
}

/** Evaluation context, when the run was part of an evaluation experiment (#15). */
export interface RunManifestEvaluation {
  datasetId?: string;
  caseId?: string;
  datasetVersion?: string;
}

/**
 * The full immutable run manifest. Every field is optional except the identity
 * anchors (`schemaVersion`, `runId`, `createdAt`) so the manifest degrades
 * gracefully when a piece of context is unavailable (e.g. local runtime, or an
 * internal synthesis run).
 */
export interface RunManifest {
  schemaVersion: number;
  runId: string;
  /** Run creation timestamp (ms epoch), mirrors `Run.startedAt`. */
  createdAt: number;
  appVersion?: string;
  buildVersion?: string;
  /** Git commit / build revision, when available at build time. */
  gitRevision?: string;
  runtimeMode: RunManifestRuntimeMode;
  provider?: string;
  model?: string;
  modelParams?: RunManifestModelParams;
  prompt?: RunManifestPrompt;
  strategy?: RunManifestStrategy;
  tools: RunManifestTool[];
  search?: RunManifestSearch;
  featureFlags?: RunManifestFeatureFlags;
  budget?: RunManifestBudget;
  locale?: string;
  evaluation?: RunManifestEvaluation;
}

/**
 * Assembled by the caller (the main-process host) at run start. The kernel
 * merges it with the run identity anchors and persists the result.
 *
 * `runtimeMode` is required; everything else is optional so the capture works
 * for internal/test runs that pass only a partial context.
 */
export interface RunManifestContext {
  runtimeMode: RunManifestRuntimeMode;
  appVersion?: string;
  buildVersion?: string;
  gitRevision?: string;
  provider?: string;
  model?: string;
  modelParams?: RunManifestModelParams;
  prompt?: RunManifestPrompt;
  strategy?: RunManifestStrategy;
  tools?: RunManifestTool[];
  search?: RunManifestSearch;
  featureFlags?: RunManifestFeatureFlags;
  budget?: RunManifestBudget;
  locale?: string;
  evaluation?: RunManifestEvaluation;
}

/**
 * Per-run override of the base manifest context (#21). Same shape as
 * `RunManifestContext` but every field is optional: the base context supplied
 * by the host fills in the runtime mode and the live settings, while a caller
 * (e.g. the evaluation runner) only adds the fields it owns — such as the gold
 * case / dataset identity.
 */
export type RunManifestContextPatch = Partial<RunManifestContext>;

/** A single resolved difference between two manifests. */
export interface RunManifestFieldDiff {
  /** Dotted path, e.g. `model`, `modelParams.thinkingLevel`, `prompt.hash`. */
  path: string;
  before: unknown;
  after: unknown;
}

/** Structured diff between two run manifests. */
export interface RunManifestDiff {
  /** True when at least one field differs. */
  changed: boolean;
  /** Per-field differences, in stable declaration order. */
  fields: RunManifestFieldDiff[];
  /** Group flags for the dimensions the issue cares about. */
  groups: {
    model: boolean;
    prompt: boolean;
    tools: boolean;
    config: boolean;
    versions: boolean;
  };
}
