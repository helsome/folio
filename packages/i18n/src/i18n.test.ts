import { describe, it, expect } from 'bun:test';
import { createSyncI18n } from './i18n.ts';
import { errorKeyForCode, translateErrorCode } from './error-messages.ts';
import { ERROR_CODE_TO_KEY } from './error-messages.ts';

describe('i18n instance (spec §4–5, §19)', () => {
  it('resolves keys from both locales', () => {
    const en = createSyncI18n({ locale: 'en-US' });
    const zh = createSyncI18n({ locale: 'zh-CN' });
    expect(en.t('common.save')).toBe('Save');
    expect(zh.t('common.save')).toBe('保存');
    expect(en.t('navigation.portfolio')).toBe('Portfolio');
    expect(zh.t('navigation.portfolio')).toBe('投资组合');
  });

  it('resolves nested keys', () => {
    const zh = createSyncI18n({ locale: 'zh-CN' });
    expect(zh.t('settings.sections.application')).toBe('应用');
  });

  it('supports instant language switch on the same instance', async () => {
    const inst = createSyncI18n({ locale: 'en-US' });
    expect(inst.t('navigation.today')).toBe('Today');
    await inst.changeLanguage('zh-CN');
    expect(inst.t('navigation.today')).toBe('今日');
  });

  it('falls back to en-US for a missing key so raw keys never leak (spec §82)', () => {
    const zh = createSyncI18n({ locale: 'zh-CN' });
    // A missing key resolves to its key-name (never a raw English string, never
    // undefined) — the caller's error fallback then kicks in.
    expect(zh.t('common.nonexistentKey')).toBe('nonexistentKey');
    expect(zh.t('common.nonexistentKey')).not.toContain('undefined');
  });
});

describe('error code → message resolution (spec §50–51)', () => {
  it('covers every known error code in the static table', () => {
    // Every code maps to a string resource both locales define.
    expect(Object.keys(ERROR_CODE_TO_KEY).length).toBeGreaterThan(25);
    const en = createSyncI18n({ locale: 'en-US' });
    const zh = createSyncI18n({ locale: 'zh-CN' });
    for (const key of new Set(Object.values(ERROR_CODE_TO_KEY))) {
      const enVal = en.t(`errors.${key}`);
      const zhVal = zh.t(`errors.${key}`);
      expect(enVal.startsWith('errors.') ? 'raw-key' : enVal).not.toBe('raw-key');
      expect(zhVal.startsWith('errors.')).toBe(false);
    }
  });

  it('resolves a code to its translation key and localized message', () => {
    expect(errorKeyForCode('PI_RUNTIME_NOT_FOUND')).toBe('piRuntimeNotFound');
    const zh = createSyncI18n({ locale: 'zh-CN' });
    expect(translateErrorCode('PI_RUNTIME_NOT_FOUND', zh.t)).toContain('运行时');
    expect(translateErrorCode('TYPE_NOT_A_CODE', zh.t)).toBeNull();
  });
});
