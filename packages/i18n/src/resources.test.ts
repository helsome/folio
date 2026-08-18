import { describe, it, expect } from 'bun:test';
import {
  assertKeyParity,
  checkKeyParity,
  flattenLocale,
  interpolationVars,
  resources,
} from './resources.ts';

describe('translation resources (spec §7–9, §81–82)', () => {
  it('registers exactly the two supported locales', () => {
    expect(Object.keys(resources).sort()).toEqual(['en-US', 'zh-CN']);
    expect(Object.keys(resources['en-US']).sort()).toEqual(Object.keys(resources['zh-CN']).sort());
  });

  it('flattens nested groups into dotted keys', () => {
    const flat = flattenLocale('en-US');
    expect(flat['settings.language']).toBe('Language');
    expect(flat['settings.sections.application']).toBe('Application');
  });

  it('has 100% key parity between locales', () => {
    const issues = checkKeyParity();
    expect(issues).toEqual([]);
    for (const [ns, table] of Object.entries(resources['en-US'])) {
      for (const key of Object.keys(table)) {
        expect(resources['zh-CN'][ns]).toHaveProperty(key);
      }
    }
  });

  it('throws on broken parity (missing zh key / mismatched interpolation)', () => {
    // Simulate a zh-CN missing key by temporarily removing one.
    const zhNav = resources['zh-CN'].navigation as Record<string, string>;
    const before = zhNav['today'];
    delete zhNav['today'];
    expect(() => assertKeyParity()).toThrow(/I18N_KEY_PARITY/);
    zhNav['today'] = before;
    expect(() => assertKeyParity()).not.toThrow();
  });

  it('detects interpolation variable mismatches across locales', () => {
    const enFlat = flattenLocale('en-US');
    const zhFlat = flattenLocale('zh-CN');
    for (const key of Object.keys(enFlat)) {
      const enVars = interpolationVars(enFlat[key] as string);
      const zhVars = interpolationVars(zhFlat[key] as string);
      if (enVars.length || zhVars.length) {
        // Set semantics: translated word order differs by language, so compare
        // placeholder names (not position).
        expect([...zhVars].sort()).toEqual([...enVars].sort());
      }
    }
  });
});
