import React, { useCallback, useEffect, useState } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import { llmStateAtom, onboardingCompletedAtom } from '../../atoms';
import { useFinagentClient } from '../../client';
import { loadConnections } from '../../client/connections';
import { shouldShowOnboarding } from './wizardState';
import { OnboardingWizard } from './OnboardingWizard';

/**
 * First-run detection + full-screen overlay (spec §27). Mount this once at the
 * app root (inside the FinagentClientProvider); the Lead wires the exact mount
 * point in AppShell/App. It self-hides once onboarding is completed/skipped.
 *
 * Completion persists in the main process (userData/onboarding.json) so a
 * packaged build — where web storage is not reliably durable — still remembers
 * the user across restarts. The localStorage atom remains as the fast path
 * and dev fallback; the main-process value is authoritative when present.
 */
export const OnboardingOverlay: React.FC = () => {
  const client = useFinagentClient();
  const [completed, setCompleted] = useAtom(onboardingCompletedAtom);
  const [llmState] = useAtom(llmStateAtom);
  const [providerConnected, setProviderConnected] = useState(false);
  const [checked, setChecked] = useState(false);
  const [mainFlagLoaded, setMainFlagLoaded] = useState(false);

  // Authoritative completion flag from the main process.
  useEffect(() => {
    let mounted = true;
    const getCompleted = client.onboarding?.getCompleted;
    if (typeof getCompleted !== 'function') {
      setMainFlagLoaded(true);
      return;
    }
    void getCompleted()
      .then((result) => {
        if (!mounted) return;
        if (result.ok) setCompleted(result.data);
      })
      .catch(() => undefined)
      .finally(() => {
        if (mounted) setMainFlagLoaded(true);
      });
    return () => {
      mounted = false;
    };
  }, [client, setCompleted]);

  useEffect(() => {
    let mounted = true;
    void loadConnections(client)
      .then((entries) => {
        if (!mounted) return;
        setProviderConnected(
          entries.some(
            (entry) => entry.status === 'connected' || entry.status === 'permission-limited'
          )
        );
      })
      .catch(() => {
        if (!mounted) return;
        setProviderConnected(false);
      })
      .finally(() => {
        if (mounted) setChecked(true);
      });
    return () => {
      mounted = false;
    };
  }, [client]);

  const handleComplete = useCallback(() => {
    setCompleted(true);
    const setMain = client.onboarding?.setCompleted;
    if (typeof setMain === 'function') {
      void setMain(true).catch(() => undefined);
    }
  }, [client, setCompleted]);

  // Wait for both the provider check and the authoritative flag before
  // deciding: never flash the wizard over a connected session, and never
  // block clicks racing the checks.
  if (!checked || !mainFlagLoaded) return null;

  const show = shouldShowOnboarding({
    llmConfigured: llmState.model != null,
    providerConnected,
    completed,
  });

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background" data-testid="onboarding-overlay">
      <div className="flex h-full w-full flex-col overflow-hidden">
        <OnboardingWizard onComplete={handleComplete} />
      </div>
    </div>
  );
};
