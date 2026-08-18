// Evaluation / observability settings (spec §11, §58, §61-63).
import type { EvaluationSettings, PrivacyLevel } from '@finagent/core';

export const DEFAULT_EVALUATION_SETTINGS: EvaluationSettings = {
  tracingEnabled: false,
  langsmithProject: 'folio-agent',
  langsmithEndpoint: '',
  privacyLevel: 'standard',
  onlineEvaluationEnabled: false,
  apiKeyConfigured: false,
  updatedAt: 0,
};

const PRIVACY_LEVELS: readonly PrivacyLevel[] = ['minimal', 'standard', 'full'];

export function isPrivacyLevel(value: unknown): value is PrivacyLevel {
  return typeof value === 'string' && (PRIVACY_LEVELS as readonly string[]).includes(value);
}

/** Sanitize a partial settings object from IPC/localStorage into full settings. */
export function sanitizeSettings(
  input: Partial<EvaluationSettings> | Record<string, unknown> | null | undefined
): EvaluationSettings {
  const base = { ...DEFAULT_EVALUATION_SETTINGS };
  if (!input || typeof input !== 'object') return base;
  const src = input as Record<string, unknown>;
  return {
    ...base,
    tracingEnabled: typeof src.tracingEnabled === 'boolean' ? src.tracingEnabled : base.tracingEnabled,
    langsmithProject:
      typeof src.langsmithProject === 'string' && src.langsmithProject.trim().length > 0
        ? src.langsmithProject.trim().slice(0, 128)
        : base.langsmithProject,
    langsmithEndpoint:
      typeof src.langsmithEndpoint === 'string' ? src.langsmithEndpoint.trim().slice(0, 512) : base.langsmithEndpoint,
    privacyLevel: isPrivacyLevel(src.privacyLevel) ? src.privacyLevel : base.privacyLevel,
    onlineEvaluationEnabled:
      typeof src.onlineEvaluationEnabled === 'boolean' ? src.onlineEvaluationEnabled : base.onlineEvaluationEnabled,
    apiKeyConfigured: typeof src.apiKeyConfigured === 'boolean' ? src.apiKeyConfigured : base.apiKeyConfigured,
    updatedAt: typeof src.updatedAt === 'number' ? src.updatedAt : base.updatedAt,
  };
}

/** Renderer-safe snapshot (never carries secrets; spec §12/§63). */
export function toSafeSettings(settings: EvaluationSettings, updatedAt: number): EvaluationSettings {
  return { ...settings, updatedAt };
}