import { describe, it, expect } from 'bun:test';
import {
  isLocalePreference,
  isSupportedLocale,
  resolveLocale,
  toSupportedLocale,
} from './locales.ts';

describe('locale guards', () => {
  it('accepts only supported locale codes', () => {
    expect(isSupportedLocale('zh-CN')).toBe(true);
    expect(isSupportedLocale('en-US')).toBe(true);
    expect(isSupportedLocale('fr')).toBe(false);
    expect(isSupportedLocale('cn')).toBe(false);
    expect(isSupportedLocale(undefined)).toBe(false);
  });

  it('accepts system plus supported locales as preferences', () => {
    expect(isLocalePreference('system')).toBe(true);
    expect(isLocalePreference('zh-CN')).toBe(true);
    expect(isLocalePreference('en-US')).toBe(true);
    expect(isLocalePreference('english')).toBe(false);
    expect(isLocalePreference('zh')).toBe(false);
  });
});

describe('resolveLocale (spec §17, §90)', () => {
  it('pinned preference wins verbatim', () => {
    expect(resolveLocale('zh-CN', 'en-US')).toBe('zh-CN');
    expect(resolveLocale('en-US', 'zh-CN')).toBe('en-US');
  });

  it('system + zh-* → zh-CN', () => {
    for (const tag of ['zh-CN', 'zh-Hans', 'zh-SG', 'zh-TW', 'zh-Hant', 'zh-Hans-CN']) {
      expect(resolveLocale('system', tag)).toBe('zh-CN');
    }
  });

  it('system + non-Chinese → en-US (first-launch default, unsupported fallback)', () => {
    for (const tag of ['en-US', 'en-GB', 'ja-JP', 'fr-FR', 'de-DE', 'ko-KR']) {
      expect(resolveLocale('system', tag)).toBe('en-US');
    }
  });

  it('lenient toSupportedLocale narrows any tag', () => {
    expect(toSupportedLocale('en-GB')).toBe('en-US');
    expect(toSupportedLocale('zh-CN')).toBe('zh-CN');
  });
});
