import type { NamespaceResource } from '../keys.ts';

/** First-run onboarding (spec §27–30, §71–72). Provider/model ids stay untranslated (§11). */
export const onboarding = {
  setupAria: 'Folio setup',
  setupTitle: 'Set up Folio',
  stepPrefix: 'Step {{index}} of {{total}}',
  skip: 'Skip for now',
  back: 'Back',
  continue: 'Continue',
  startFolio: 'Start Folio',
  language: 'Language',
  welcome: {
    title: 'Welcome to Folio',
    titleShort: 'Welcome',
    subtitle:
      'A few minutes of setup gets your market data and AI connected. You can skip any step and return later from Settings.',
    accept: 'I understand and accept these terms.',
    disclaimerPrivacyTitle: 'Privacy',
    disclaimerPrivacyBody:
      'Folio runs locally on your device. API keys and credentials are stored on your machine and never shared. Market-data providers receive only the requests made through your own accounts.',
    disclaimerAiTitle: 'AI analysis',
    disclaimerAiBody:
      'AI-generated analysis is for informational purposes only and may be inaccurate or incomplete. Always verify outputs before relying on them.',
    disclaimerFinancialTitle: 'Financial information',
    disclaimerFinancialBody:
      'Nothing in Folio is financial advice. Market data may be delayed. You are solely responsible for your investment decisions.',
  },
  connectAi: {
    title: 'Connect AI',
    titleShort: 'Connect AI',
    subtitle: 'Choose an LLM provider, add its credential, and pick a model.',
    model: 'Model',
    providersCredentials: 'Providers & credentials',
    loadingProviders: 'Loading providers…',
    configured: 'Configured',
    apiKey: 'API key',
    save: 'Save',
    test: 'Test',
  },
  providerStep: {
    notAvailable:
      "This provider isn't available in this build yet — connect it later from Settings → Connections.",
    recommended: 'Recommended',
  },
  broker: {
    title: 'Broker Account (optional)',
    titleShort: 'Broker Account',
    subtitle:
      'Connect your Longbridge brokerage account for portfolio, positions, and cash flow.',
  },
  connectData: {
    title: 'Connect Financial Data',
    titleShort: 'Connect Financial Data',
    subtitle:
      'Longbridge powers quotes, klines, and company data across US, HK, CN, and SG markets.',
  },
  environment: {
    title: 'Check Environment',
    titleShort: 'Check Environment',
    subtitle: 'A quick check that everything you connected is ready to use.',
    checking: 'Checking environment…',
    notAvailable: "Health checks aren't available in this build yet.",
    ready: 'Ready',
    unavailable: 'Unavailable',
    itemAi: 'AI',
    itemMarketData: 'Market Data',
    itemSkills: 'Skills',
    itemAgentRuntime: 'Agent Runtime',
  },
} satisfies NamespaceResource;
