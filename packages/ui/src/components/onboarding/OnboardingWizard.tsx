import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
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

const STEP_SHORT_KEY: Record<WizardStep, string> = {
  welcome: 'onboarding.welcome.titleShort',
  'connect-ai': 'onboarding.connectAi.titleShort',
  'connect-data': 'onboarding.connectData.titleShort',
  broker: 'onboarding.broker.titleShort',
  environment: 'onboarding.environment.titleShort',
};

/** The first-run onboarding flow (spec §27–30). */
export const OnboardingWizard: React.FC<{ onComplete: () => void }> = ({ onComplete }) => {
  const { t } = useTranslation();
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
      aria-label={t('onboarding.setupAria')}
      data-testid="onboarding-wizard"
    >
      <header className="flex items-center justify-between border-b mac-section-divider px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="text-[15px] font-semibold text-foreground">{t('onboarding.setupTitle')}</span>
          <span className="rounded-full border mac-section-divider px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground/48">
            {t('onboarding.stepPrefix', { index: index + 1, total: steps.length })}
          </span>
        </div>
        <span className="text-[12px] text-foreground/48">{t(STEP_SHORT_KEY[current])}</span>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {current === 'welcome' && <WelcomeStep />}
        {current === 'connect-ai' && <ConnectAiStep />}
        {current === 'connect-data' && (
          <ProviderConnectStep
            title={t('onboarding.connectData.title')}
            subtitle={t('onboarding.connectData.subtitle')}
            recommended
            entry={longbridge}
            onChanged={() => void refresh()}
          />
        )}
        {current === 'broker' && (
          <ProviderConnectStep
            title={t('onboarding.broker.title')}
            subtitle={t('onboarding.broker.subtitle')}
            entry={longbridge}
            onChanged={() => void refresh()}
          />
        )}
        {current === 'environment' && <EnvironmentStep report={report} loading={healthLoading} />}
      </div>

      <footer className="flex items-center justify-between border-t mac-section-divider px-6 py-4">
        <Button variant="ghost" size="sm" onClick={finish} data-testid="onboarding-skip">
          {t('onboarding.skip')}
        </Button>
        <div className="flex items-center gap-2">
          {index > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrent(prevStep(steps, current))}
              data-testid="onboarding-back"
            >
              {t('onboarding.back')}
            </Button>
          )}
          <Button
            size="sm"
            onClick={onContinue}
            disabled={!canContinue}
            data-testid={isLast ? 'onboarding-finish' : 'onboarding-continue'}
          >
            {isLast ? t('onboarding.startFolio') : t('onboarding.continue')}
          </Button>
        </div>
      </footer>
    </div>
  );
};
