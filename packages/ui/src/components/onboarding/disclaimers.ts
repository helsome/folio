/**
 * Welcome-step disclaimers (spec §42) — one-time accept, re-viewable later via
 * Settings/About. Content only; persistence lives in `atoms/onboardingAtoms`.
 */

export interface Disclaimer {
  id: string;
  title: string;
  body: string;
}

export const DISCLAIMERS: readonly Disclaimer[] = [
  {
    id: 'privacy',
    title: 'Privacy',
    body:
      'Folio runs locally on your device. API keys and credentials are stored on your machine ' +
      'and never shared. Market-data providers receive only the requests made through your own accounts.',
  },
  {
    id: 'ai-analysis',
    title: 'AI analysis',
    body:
      'AI-generated analysis is for informational purposes only and may be inaccurate or ' +
      'incomplete. Always verify outputs before relying on them.',
  },
  {
    id: 'financial-information',
    title: 'Financial information',
    body:
      'Nothing in Folio is financial advice. Market data may be delayed. You are solely ' +
      'responsible for your investment decisions.',
  },
] as const;
