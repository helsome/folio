import { atom } from 'jotai';
import type { Alert } from '@finagent/core';
import type { FinagentClient } from '../client';

interface AlertState {
  alerts: Alert[];
  loading: boolean;
  error: string | null;
}

async function persistAlerts(client: FinagentClient, alerts: Alert[]): Promise<void> {
  const result = await client.alerts.save(alerts);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
}

export const alertStateAtom = atom<AlertState>({
  alerts: [],
  loading: false,
  error: null,
});

// Add new alert
export const addAlertAtom = atom(
  null,
  async (get, set, input: { client: FinagentClient; alert: Alert }) => {
    const nextAlerts = [...get(alertStateAtom).alerts, input.alert];
    set(alertStateAtom, (state) => ({ ...state, alerts: nextAlerts }));
    await persistAlerts(input.client, nextAlerts);
  }
);

// Remove alert
export const removeAlertAtom = atom(
  null,
  async (get, set, input: { client: FinagentClient; alertId: string }) => {
    const nextAlerts = get(alertStateAtom).alerts.filter((a) => a.id !== input.alertId);
    set(alertStateAtom, (state) => ({ ...state, alerts: nextAlerts }));
    await persistAlerts(input.client, nextAlerts);
  }
);

// Toggle alert enabled state
export const toggleAlertAtom = atom(
  null,
  async (get, set, input: { client: FinagentClient; alertId: string }) => {
    const nextAlerts = get(alertStateAtom).alerts.map((alert) =>
      alert.id === input.alertId ? { ...alert, enabled: !alert.enabled } : alert
    );
    set(alertStateAtom, (state) => ({ ...state, alerts: nextAlerts }));
    await persistAlerts(input.client, nextAlerts);
  }
);

// Mark alert as triggered
export const triggerAlertAtom = atom(
  null,
  (get, set, alertId: string) => {
    set(alertStateAtom, (state) => ({
      ...state,
      alerts: state.alerts.map((a) =>
        a.id === alertId ? { ...a, triggered: true, triggeredAt: Date.now() } : a
      ),
    }));
  }
);

// Load alerts from storage
export const loadAlertsAtom = atom(
  null,
  async (_get, set, client: FinagentClient) => {
    set(alertStateAtom, (state) => ({ ...state, loading: true, error: null }));

    try {
      const result = await client.alerts.load();
      if (!result.ok) {
        throw new Error(result.error.message);
      }

      set(alertStateAtom, {
        alerts: result.data,
        loading: false,
        error: null,
      });
    } catch (error) {
      set(alertStateAtom, (state) => ({
        ...state,
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to load alerts',
      }));
    }
  }
);

// Save alerts to storage
export const saveAlertsAtom = atom(
  null,
  async (get, set, client: FinagentClient) => {
    const state = get(alertStateAtom);
    try {
      const result = await client.alerts.save(state.alerts);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
    } catch (error) {
      set(alertStateAtom, (state) => ({
        ...state,
        error: error instanceof Error ? error.message : 'Failed to save alerts',
      }));
    }
  }
);
