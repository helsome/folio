/**
 * Onboarding wizard step state machine (spec §27–30) — pure, no I/O.
 *
 * The step sequence is dynamic: Connect AI is omitted when an LLM is already
 * configured. First-run detection gates the whole overlay on
 * `!completed && !llmConfigured && !providerConnected`.
 */

export type WizardStep = 'welcome' | 'connect-ai' | 'connect-data' | 'broker' | 'environment';

export interface WizardInputs {
  llmConfigured: boolean;
  providerConnected: boolean;
  completed: boolean;
}

/** First-run detection predicate (spec §27). */
export function shouldShowOnboarding(inputs: WizardInputs): boolean {
  return !inputs.completed && !inputs.llmConfigured && !inputs.providerConnected;
}

/** The ordered step list, omitting Connect AI when an LLM is already configured. */
export function buildWizardSteps(inputs: { llmConfigured: boolean }): WizardStep[] {
  const steps: WizardStep[] = ['welcome'];
  if (!inputs.llmConfigured) steps.push('connect-ai');
  steps.push('connect-data', 'broker', 'environment');
  return steps;
}

/** Advance one step, clamping at the final step. */
export function nextStep(steps: readonly WizardStep[], current: WizardStep): WizardStep {
  const index = steps.indexOf(current);
  if (index < 0 || index >= steps.length - 1) return current;
  return steps[index + 1];
}

/** Move back one step, clamping at the first step. */
export function prevStep(steps: readonly WizardStep[], current: WizardStep): WizardStep {
  const index = steps.indexOf(current);
  if (index <= 0) return steps[0];
  return steps[index - 1];
}

/** Zero-based index of the current step within the active sequence. */
export function stepIndex(steps: readonly WizardStep[], current: WizardStep): number {
  const index = steps.indexOf(current);
  return index < 0 ? 0 : index;
}
