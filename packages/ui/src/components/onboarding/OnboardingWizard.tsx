import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import { completeOnboardingAtom, disclaimersAcceptedAtom, llmStateAtom } from '../../atoms';
import { useFinagentClient } from '../../client';
import {
  loadConnections,
  loadHealthCheck,
  type ConnectionEntry,
  type HealthCheckReport,
} from '../../client/connections';
import { buildWizardSteps, nextStep, prevStep, stepIndex, type WizardStep } from './wizardState';
import { WelcomeStep } from './WelcomeStep';
import { ConnectAiStep } from './ConnectAiStep';
import { ProviderConnectStep } from './ProviderConnectStep';
import { EnvironmentStep } from './EnvironmentStep';
import { Button } from '../primitives/Button';

const STEP_TITLES: Record<WizardStep, string> = {
  welcome: 'Welcome',
  'connect-ai': 'Connect AI',
  'connect-data': 'Connect Financial Data',
  broker: 'Broker Account',
  environment: 'Check Environment',
};

/** The first-run onboarding flow (spec §27–30). */
export const OnboardingWizard: React.FC<{ onComplete: () => void }> = ({ onComplete }) => {
  const client = useFinagentClient();
  const [llmState] = useAtom(llmStateAtom);
  const [disclaimersAccepted] = useAtom(disclaimersAcceptedAtom);
  const complete = useSetAtom(completeOnboardingAtom);

  const llmConfigured = llmState.model != null;
  const steps = useMemo(() => buildWizardSteps({ llmConfigured }), [llmConfigured]);

  const [current, setCurrent] = useState<WizardStep>(steps[0]);
  const [entries, setEntries] = useState<ConnectionEntry[]>([]);
  const [report, setReport] = useState<HealthCheckReport | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);

  // Keep the current step in sync if the sequence shrinks (e.g. AI configured).
  useEffect(() => {
    if (!steps.includes(current)) setCurrent(steps[0]);
  }, [steps, current]);

  const refresh = useCallback(async () => {
    const [conns, health] = await Promise.all([loadConnections(client), loadHealthCheck(client)]);
    setEntries(conns);
    setReport(health);
    setHealthLoading(false);
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const longbridge = entries.find((entry) => entry.providerId === 'longbridge') ?? null;

  const finish = useCallback(() => {
    complete();
    onComplete();
  }, [complete, onComplete]);

  const canContinue =
    current === 'welcome' ? disclaimersAccepted : current === 'connect-ai' ? llmConfigured : true;

  const index = stepIndex(steps, current);
  const isLast = index === steps.length - 1;

  const onContinue = () => {
    if (!canContinue) return;
    if (isLast) {
      finish();
    } else {
      setCurrent(nextStep(steps, current));
    }
  };

  return (
    <div
      className="flex h-full flex-col"
      role="dialog"
      aria-label="Folio setup"
      data-testid="onboarding-wizard"
    >
      <header className="flex items-center justify-between border-b mac-section-divider px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="text-[15px] font-semibold text-foreground">Set up Folio</span>
          <span className="rounded-full border mac-section-divider px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground/48">
            Step {index + 1} of {steps.length}
          </span>
        </div>
        <span className="text-[12px] text-foreground/48">{STEP_TITLES[current]}</span>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {current === 'welcome' && <WelcomeStep />}
        {current === 'connect-ai' && <ConnectAiStep />}
        {current === 'connect-data' && (
          <ProviderConnectStep
            title="Connect Financial Data"
            subtitle="Longbridge powers quotes, klines, and company data across US, HK, CN, and SG markets."
            recommended
            entry={longbridge}
            onChanged={() => void refresh()}
          />
        )}
        {current === 'broker' && (
          <ProviderConnectStep
            title="Broker Account (optional)"
            subtitle="Connect your Longbridge brokerage account for portfolio, positions, and cash flow."
            entry={longbridge}
            onChanged={() => void refresh()}
          />
        )}
        {current === 'environment' && <EnvironmentStep report={report} loading={healthLoading} />}
      </div>

      <footer className="flex items-center justify-between border-t mac-section-divider px-6 py-4">
        <Button variant="ghost" size="sm" onClick={finish} data-testid="onboarding-skip">
          Skip for now
        </Button>
        <div className="flex items-center gap-2">
          {index > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrent(prevStep(steps, current))}
              data-testid="onboarding-back"
            >
              Back
            </Button>
          )}
          <Button
            size="sm"
            onClick={onContinue}
            disabled={!canContinue}
            data-testid={isLast ? 'onboarding-finish' : 'onboarding-continue'}
          >
            {isLast ? 'Start Folio' : 'Continue'}
          </Button>
        </div>
      </footer>
    </div>
  );
};
