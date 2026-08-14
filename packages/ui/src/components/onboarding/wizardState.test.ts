import { describe, expect, it } from 'bun:test';
import {
  buildWizardSteps,
  nextStep,
  prevStep,
  shouldShowOnboarding,
  stepIndex,
} from './wizardState';

describe('onboarding wizard state machine', () => {
  it('shows only on a true first run', () => {
    expect(
      shouldShowOnboarding({ llmConfigured: false, providerConnected: false, completed: false })
    ).toBe(true);
    expect(
      shouldShowOnboarding({ llmConfigured: true, providerConnected: false, completed: false })
    ).toBe(false);
    expect(
      shouldShowOnboarding({ llmConfigured: false, providerConnected: true, completed: false })
    ).toBe(false);
    expect(
      shouldShowOnboarding({ llmConfigured: false, providerConnected: false, completed: true })
    ).toBe(false);
  });

  it('omits Connect AI when an LLM is already configured', () => {
    expect(buildWizardSteps({ llmConfigured: false })).toEqual([
      'welcome',
      'connect-ai',
      'connect-data',
      'broker',
      'environment',
    ]);
    expect(buildWizardSteps({ llmConfigured: true })).toEqual([
      'welcome',
      'connect-data',
      'broker',
      'environment',
    ]);
  });

  it('advances through the sequence and clamps at the end', () => {
    const steps = buildWizardSteps({ llmConfigured: false });
    expect(nextStep(steps, 'welcome')).toBe('connect-ai');
    expect(nextStep(steps, 'connect-ai')).toBe('connect-data');
    expect(nextStep(steps, 'environment')).toBe('environment');
  });

  it('moves backward and clamps at the first step', () => {
    const steps = buildWizardSteps({ llmConfigured: false });
    expect(prevStep(steps, 'connect-data')).toBe('connect-ai');
    expect(prevStep(steps, 'welcome')).toBe('welcome');
  });

  it('computes a zero-based index for the active sequence', () => {
    const steps = buildWizardSteps({ llmConfigured: true });
    expect(stepIndex(steps, 'welcome')).toBe(0);
    expect(stepIndex(steps, 'environment')).toBe(3);
  });
});
