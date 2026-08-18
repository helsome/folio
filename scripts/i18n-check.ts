#!/usr/bin/env bun
/**
 * i18n:check — V8 translation gate (spec §81–84, §103).
 *
 * Verifies:
 *   1. only supported locales are registered
 *   2. namespace resources contain only strings / nested groups
 *   3. key parity — every key in en-US exists in zh-CN and vice versa
 *   4. interpolation parity — `{{var}}` sets match across locales
 *
 * Fails (exit 1) on any issue so CI can gate on it. Runs offline; no network.
 */
import {
  checkKeyParity,
  flattenLocale,
  resources,
  SUPPORTED_LOCALES_FOR_RESOURCES,
} from '../packages/i18n/src/resources.ts';

let failures = 0;
const fail = (line: string): void => {
  failures += 1;
  console.error(`  ✗ ${line}`);
};

console.log('i18n:check');
console.log(`  supported locales: ${SUPPORTED_LOCALES_FOR_RESOURCES.join(', ')}`);

// 1. Only supported locales registered.
const validLocales = new Set<string>(SUPPORTED_LOCALES_FOR_RESOURCES);
for (const locale of Object.keys(resources)) {
  if (!validLocales.has(locale)) fail(`unexpected locale registered: ${locale}`);
}

// 2. Namespace shape validity (strings or nested groups only).
for (const [locale, bundle] of Object.entries(resources)) {
  const walk = (ns: string, prefix: string, node: Record<string, unknown>): void => {
    for (const [k, v] of Object.entries(node)) {
      const path = prefix === '' ? `${ns}.${k}` : `${prefix}.${k}`;
      if (typeof v === 'string') continue;
      if (v !== null && typeof v === 'object') {
        walk(ns, path, v as Record<string, unknown>);
      } else {
        fail(`[${locale}/${ns}] value at "${path}" is not a string/group (${typeof v})`);
      }
    }
  };
  for (const [ns, table] of Object.entries(bundle)) {
    walk(ns, '', table as Record<string, unknown>);
  }
}

// 3+4. Key parity + interpolation parity.
const issues = checkKeyParity();
for (const issue of issues) {
  fail(`[${issue.type} ${issue.locale}] ${issue.key}${issue.detail ? ` — ${issue.detail}` : ''}`);
}

const enCount = Object.keys(flattenLocale('en-US')).length;
const zhCount = Object.keys(flattenLocale('zh-CN')).length;

if (failures === 0) {
  console.log(`  ✓ key parity: en-US ${enCount} keys ≡ zh-CN ${zhCount} keys (0 issues)`);
  console.log('i18n:check passed ✅');
  process.exit(0);
} else {
  console.error(`  en-US: ${enCount} keys · zh-CN: ${zhCount} keys`);
  console.error(`i18n:check FAILED — ${failures} issue(s)`);
  process.exit(1);
}
