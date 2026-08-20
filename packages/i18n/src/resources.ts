/**
 * Translation resources for i18next (spec §7–9).
 *
 * Both locales must stay key-identical — `i18n:check` enforces that in CI and
 * `assertKeyParity` guards it at boot. Interpolation placeholders are tracked
 * separately (`{{name}}`) so a runtime substitution can never render
 * `undefined`.
 */
import type { SupportedLocale } from './locales.ts';
import { enUsResources } from './locales/en-US/index.ts';
import { zhCnResources } from './locales/zh-CN/index.ts';
import type { NamespaceResource } from './locales/keys.ts';

export type I18nResources = Record<SupportedLocale, Record<string, NamespaceResource>>;

export const resources: I18nResources = {
  'en-US': enUsResources,
  'zh-CN': zhCnResources,
};

/** Full domain list (spec §8); feature slices may register a subset at first. */
export const SUPPORTED_NAMESPACES: readonly string[] = [
  'common',
  'navigation',
  'today',
  'discover',
  'security',
  'research',
  'thesis',
  'portfolio',
  'compare',
  'alerts',
  'automation',
  'agent',
  'trace',
  'skills',
  'performance',
  'settings',
  'connections',
  'onboarding',
  'evaluation',
  'diagnostics',
  'errors',
];

export const SUPPORTED_LOCALES_FOR_RESOURCES: readonly SupportedLocale[] = ['en-US', 'zh-CN'];

function walk(prefix: string, table: Record<string, unknown>, out: Record<string, string>): void {
  for (const [key, value] of Object.entries(table)) {
    const full = prefix === '' ? key : `${prefix}.${key}`;
    if (typeof value === 'string') out[full] = value;
    else if (Array.isArray(value)) out[full] = JSON.stringify(value);
    else if (value !== null && typeof value === 'object') walk(full, value as Record<string, unknown>, out);
  }
}

/** Flatten `namespace.key` → value (recursing nested groups) for a locale bundle. */
export function flattenLocale(locale: SupportedLocale): Record<string, string> {
  const bundle = resources[locale] ?? {};
  const flat: Record<string, string> = {};
  for (const [ns, table] of Object.entries(bundle)) {
    walk(ns, table as Record<string, unknown>, flat);
  }
  return flat;
}

/** Extract interpolation placeholders from a template. */
export function interpolationVars(template: string): string[] {
  const vars = new Set<string>();
  const re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) vars.add(m[1]);
  return [...vars];
}

export interface LocaleParityIssue {
  type: 'missing' | 'extra' | 'interpolation-mismatch';
  locale: SupportedLocale;
  key: string;
  detail?: string;
}

/** Structural parity check between the two locales (used by i18n:check + boot). */
export function checkKeyParity(): LocaleParityIssue[] {
  const issues: LocaleParityIssue[] = [];
  for (const locale of SUPPORTED_LOCALES_FOR_RESOURCES) {
    const other = locale === 'en-US' ? 'zh-CN' : 'en-US';
    const flat = flattenLocale(locale);
    const otherFlat = flattenLocale(other);
    for (const key of Object.keys(flat)) {
      if (!(key in otherFlat)) {
        issues.push({ type: 'missing', locale: other, key });
      } else {
        const aVars = interpolationVars(flat[key]);
        const bVars = interpolationVars(otherFlat[key]);
        if (aVars.length > 0 || bVars.length > 0) {
          const missing =
            aVars.some((v) => !bVars.includes(v)) || bVars.some((v) => !aVars.includes(v));
          if (missing) {
            issues.push({
              type: 'interpolation-mismatch',
              locale,
              key,
              detail: `${JSON.stringify(aVars)} vs ${JSON.stringify(bVars)}`,
            });
          }
        }
      }
    }
    for (const key of Object.keys(otherFlat)) {
      if (!(key in flat)) issues.push({ type: 'extra', locale, key });
    }
  }
  return issues;
}

/** Throw when key parity is broken (called at i18n boot in dev/test). */
export function assertKeyParity(): void {
  const issues = checkKeyParity();
  if (issues.length > 0) {
    const sample = issues
      .slice(0, 8)
      .map(
        (i) =>
          `[${i.type} ${i.locale}] ${i.key}${i.detail ? ` ${i.detail}` : ''}`
      )
      .join('\n');
    throw new Error(
      `I18N_KEY_PARITY: ${issues.length} issue(s) between zh-CN and en-US translations.\n${sample}`
    );
  }
}
