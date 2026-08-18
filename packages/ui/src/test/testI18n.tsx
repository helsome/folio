import React from 'react';
import { I18nextProvider } from 'react-i18next';
import { createSyncI18n, type I18nInstance } from '@finagent/i18n';

/**
 * Renderer test i18n helper. Wraps a component so `useTranslation` resolves
 * real resource strings (default en-US) instead of throwing without a
 * provider. Assertions on English copy stay valid because the en bundle
 * renders the original English text.
 */
let instance: I18nInstance | null = null;

export function i18nInstance(): I18nInstance {
  if (instance === null) instance = createSyncI18n({ locale: 'en-US' });
  return instance;
}

export const TestI18n: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <I18nextProvider i18n={i18nInstance()}>{children}</I18nextProvider>
);
