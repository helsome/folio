import React from 'react';
import { I18nextProvider } from 'react-i18next';
import { createSyncI18n, type SupportedLocale } from '@finagent/i18n';

/**
 * Test helper: wrap a node in an i18next provider backed by the real
 * en-US/zh-CN resources so component tests assert actual translated copy.
 */
export function withI18n(
  node: React.ReactNode,
  locale: SupportedLocale = 'en-US'
): React.ReactElement {
  const i18n = createSyncI18n({ locale });
  return <I18nextProvider i18n={i18n}>{node}</I18nextProvider>;
}
