// Live evaluation preflight (issue #113).
//
// The nightly live suite must not masquerade as a benchmark when nothing was
// measurable: before any case runs, prove that the Pi runtime is reachable,
// the selected model exists and has working credentials, the required data
// source is ready, and (when requested) the judge is fully configured. The
// report carries status only — error text is redacted and never includes
// secret values.
import type { LongBridgeStatus } from '../../packages/longbridge-tools/src/status.ts';
import type { LlmRuntimeApi } from '../../packages/shared/src/agent/pi-runtime-adapter.ts';
import { redact } from '../../packages/shared/src/diagnostics/redact.ts';

export type PreflightCheckStatus = 'ok' | 'failed' | 'skipped';

export interface PreflightCheck {
  id: 'model' | 'pi' | 'model-available' | 'credentials' | 'data-source' | 'judge';
  label: string;
  status: PreflightCheckStatus;
  detail: string;
}

export interface PreflightResult {
  mode: 'live';
  ok: boolean;
  checks: PreflightCheck[];
}

/** Judge configuration readiness, computed by the CLI from flags/env. */
export interface JudgeReadiness {
  requested: boolean;
  resolved: boolean;
  provider?: string;
  model?: string;
  /** Human-readable names of missing required settings. */
  missing: string[];
}

export interface LivePreflightInput {
  /** Agent provider under test; required (no ambient runtime defaults). */
  provider?: string;
  /** Agent model id under test; required. */
  model?: string;
  judge: JudgeReadiness;
  /** Pi runtime control surface from the kernel; undefined when not live. */
  llm?: LlmRuntimeApi;
  /** Data-source probe; defaults to the LongBridge CLI status check. */
  dataSource?: () => Promise<LongBridgeStatus>;
}

const MAX_DETAIL_CHARS = 300;

/** Redact + truncate a message before it reaches logs or artifacts. */
function safeDetail(message: string): string {
  const cleaned = redact(message).replaceAll(/\s+/g, ' ').trim();
  return cleaned.length > MAX_DETAIL_CHARS ? `${cleaned.slice(0, MAX_DETAIL_CHARS)}…` : cleaned;
}

function errorDetail(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';
  const message = error instanceof Error ? error.message : String(error);
  const detail = code.length > 0 && !message.includes(code) ? `${code}: ${message}` : message;
  return safeDetail(detail);
}

/**
 * Run every live preflight check. Checks are independent and all run even
 * after a failure so the report shows the full picture. `ok` is false when
 * any check failed.
 */
export async function runLivePreflight(input: LivePreflightInput): Promise<PreflightResult> {
  const checks: PreflightCheck[] = [];
  const { provider, model } = input;

  if (!provider || !model) {
    checks.push({
      id: 'model',
      label: 'Agent model',
      status: 'failed',
      detail:
        'No model selected. Pass --model <provider>/<model-id> (or set FINAGENT_EVAL_MODEL). ' +
        'Live suites must not rely on ambient runtime defaults.',
    });
  } else {
    checks.push({ id: 'model', label: 'Agent model', status: 'ok', detail: `${provider}/${model}` });
  }

  let runtimeReady = false;
  if (!input.llm) {
    checks.push({
      id: 'pi',
      label: 'Pi runtime',
      status: 'failed',
      detail: 'The agent kernel does not expose the Pi runtime control surface; cannot run a live suite.',
    });
  } else {
    try {
      await input.llm.getState();
      runtimeReady = true;
      checks.push({ id: 'pi', label: 'Pi runtime', status: 'ok', detail: 'get_state round-trip succeeded.' });
    } catch (error) {
      checks.push({
        id: 'pi',
        label: 'Pi runtime',
        status: 'failed',
        detail: `Runtime did not answer get_state: ${errorDetail(error)}`,
      });
    }
  }

  if (!provider || !model || !runtimeReady || !input.llm) {
    checks.push({
      id: 'model-available',
      label: 'Model availability',
      status: 'skipped',
      detail: 'Skipped: the runtime or selected model is not ready.',
    });
    checks.push({
      id: 'credentials',
      label: 'Model credentials',
      status: 'skipped',
      detail: 'Skipped: the runtime or selected model is not ready.',
    });
  } else {
    try {
      const models = await input.llm.listModels();
      const match = models.some((entry) => entry.provider === provider && entry.id === model);
      if (match) {
        checks.push({
          id: 'model-available',
          label: 'Model availability',
          status: 'ok',
          detail: `${provider}/${model} is in the runtime catalog (${models.length} model(s) available).`,
        });
      } else {
        const providers = [...new Set(models.map((entry) => entry.provider))].sort();
        checks.push({
          id: 'model-available',
          label: 'Model availability',
          status: 'failed',
          detail: `Model ${provider}/${model} is not available. Runtime providers: ${providers.join(', ') || 'none'}.`,
        });
      }
    } catch (error) {
      checks.push({
        id: 'model-available',
        label: 'Model availability',
        status: 'failed',
        detail: `Could not list runtime models: ${errorDetail(error)}`,
      });
    }

    try {
      const probe = await input.llm.testProvider(provider, model);
      if (probe.ok) {
        checks.push({
          id: 'credentials',
          label: 'Model credentials',
          status: 'ok',
          detail: `One-token prompt succeeded in ${probe.latencyMs}ms.`,
        });
      } else {
        checks.push({
          id: 'credentials',
          label: 'Model credentials',
          status: 'failed',
          detail: `Model probe failed: ${safeDetail(probe.message)}`,
        });
      }
    } catch (error) {
      checks.push({
        id: 'credentials',
        label: 'Model credentials',
        status: 'failed',
        detail: `Model probe threw: ${errorDetail(error)}`,
      });
    }
  }

  if (!input.dataSource) {
    checks.push({
      id: 'data-source',
      label: 'Data source (LongBridge)',
      status: 'skipped',
      detail: 'Skipped: no data-source probe provided.',
    });
  } else {
    try {
      const status = await input.dataSource();
      if (status.available) {
        checks.push({
          id: 'data-source',
          label: 'Data source (LongBridge)',
          status: 'ok',
          detail: 'CLI installed, authenticated, and a quote probe succeeded.',
        });
      } else {
        checks.push({
          id: 'data-source',
          label: 'Data source (LongBridge)',
          status: 'failed',
          detail: `Data source not ready (${status.status}${status.error ? `: ${safeDetail(status.error.message)}` : ''}).`,
        });
      }
    } catch (error) {
      checks.push({
        id: 'data-source',
        label: 'Data source (LongBridge)',
        status: 'failed',
        detail: `Data-source probe threw: ${errorDetail(error)}`,
      });
    }
  }

  if (!input.judge.requested) {
    checks.push({
      id: 'judge',
      label: 'Judge',
      status: 'skipped',
      detail: 'No judge requested — judged metrics will be explicitly reported as not measured.',
    });
  } else if (input.judge.resolved) {
    checks.push({
      id: 'judge',
      label: 'Judge',
      status: 'ok',
      detail: `${input.judge.provider ?? 'configured'}/${input.judge.model ?? 'configured'}`,
    });
  } else {
    checks.push({
      id: 'judge',
      label: 'Judge',
      status: 'failed',
      detail: `Judge requested but incomplete — missing ${input.judge.missing.join(', ') || 'configuration'}.`,
    });
  }

  return { mode: 'live', ok: checks.every((check) => check.status !== 'failed'), checks };
}

/** Plain-text table for logs and `$GITHUB_STEP_SUMMARY` greps. */
export function formatPreflight(result: PreflightResult): string {
  const lines = ['', '--- Live preflight ---'];
  for (const check of result.checks) {
    const mark = check.status === 'ok' ? 'ok' : check.status.toUpperCase();
    lines.push(`  [${mark.padEnd(7)}] ${check.label.padEnd(24)} ${check.detail}`);
  }
  lines.push(`PREFLIGHT: ${result.ok ? 'READY' : 'NOT READY — live suite is not valid'}`);
  return lines.join('\n');
}
