import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import type { Alert } from '@finagent/core';

interface AlertState {
  alerts: Alert[];
  loading: boolean;
  error: string | null;
}

export const alertStateAtom = atom<AlertState>({
  alerts: [],
  loading: false,
  error: null,
});

// Add new alert
export const addAlertAtom = atom(
  null,
  (get, set, alert: Alert) => {
    set(alertStateAtom, (state) => ({
      ...state,
      alerts: [...state.alerts, alert],
    }));
  }
);

// Remove alert
export const removeAlertAtom = atom(
  null,
  (get, set, alertId: string) => {
    set(alertStateAtom, (state) => ({
      ...state,
      alerts: state.alerts.filter((a) => a.id !== alertId),
    }));
  }
);

// Toggle alert enabled state
export const toggleAlertAtom = atom(
  null,
  (get, set, alertId: string) => {
    set(alertStateAtom, (state) => ({
      ...state,
      alerts: state.alerts.map((a) =>
        a.id === alertId ? { ...a, enabled: !a.enabled } : a
      ),
    }));
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
  async (get, set) => {
    set(alertStateAtom, (state) => ({ ...state, loading: true, error: null }));

    try {
      // Dynamic import to avoid circular deps
      const { loadAlerts } = await import('@finagent/shared');
      const alerts = await loadAlerts();

      set(alertStateAtom, {
        alerts,
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
  async (get, set) => {
    const state = get(alertStateAtom);
    try {
      const { saveAlerts } = await import('@finagent/shared');
      await saveAlerts(state.alerts);
    } catch (error) {
      set(alertStateAtom, (state) => ({
        ...state,
        error: error instanceof Error ? error.message : 'Failed to save alerts',
      }));
    }
  }
);