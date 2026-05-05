import React, { useEffect, useState } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import {
  alertStateAtom,
  loadAlertsAtom,
  toggleAlertAtom,
  removeAlertAtom,
  addAlertAtom,
} from '../../atoms';
import { useFinagentClient } from '../../client';
import { AlertCard } from './AlertCard';
import { AlertForm } from './AlertForm';
import { Button } from '../primitives/Button';
import { Dialog } from '../primitives/Dialog';
import type { Alert } from '@finagent/core';

export const AlertList: React.FC = () => {
  const client = useFinagentClient();
  const [state] = useAtom(alertStateAtom);
  const loadAlerts = useSetAtom(loadAlertsAtom);
  const toggleAlert = useSetAtom(toggleAlertAtom);
  const removeAlert = useSetAtom(removeAlertAtom);
  const addAlert = useSetAtom(addAlertAtom);

  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    loadAlerts(client);
  }, [client, loadAlerts]);

  const handleCreateAlert = (alertData: Omit<Alert, 'id' | 'createdAt' | 'triggered'>) => {
    const alert: Alert = {
      ...alertData,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      triggered: false,
    };
    addAlert({ client, alert });
    setShowForm(false);
  };

  const activeAlerts = state.alerts.filter((a) => !a.triggered);
  const triggeredAlerts = state.alerts.filter((a) => a.triggered);

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-[oklch(var(--bg-primary))]">
        <div className="flex justify-between items-center">
          <div className="text-xs font-semibold text-[oklch(var(--text-secondary))] uppercase tracking-wide">
            Alerts ({state.alerts.length})
          </div>
          <Button size="sm" onClick={() => setShowForm(true)}>
            + New
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {state.loading && (
          <div className="text-center py-8 text-[oklch(var(--text-secondary))]">
            Loading alerts...
          </div>
        )}

        {!state.loading && state.alerts.length === 0 && (
          <div className="text-center py-8 text-[oklch(var(--text-secondary))]">
            <p>No alerts configured</p>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowForm(true)}
              className="mt-2"
            >
              Create your first alert
            </Button>
          </div>
        )}

        {/* Active Alerts */}
        {activeAlerts.length > 0 && (
          <>
            <div className="text-xs text-[oklch(var(--text-secondary))] px-2 py-1">
              Active
            </div>
            {activeAlerts.map((alert) => (
              <AlertCard
                key={alert.id}
                alert={alert}
                onToggle={() => toggleAlert({ client, alertId: alert.id })}
                onRemove={() => removeAlert({ client, alertId: alert.id })}
              />
            ))}
          </>
        )}

        {/* Triggered Alerts */}
        {triggeredAlerts.length > 0 && (
          <>
            <div className="text-xs text-[oklch(var(--text-secondary))] px-2 py-1 mt-4">
              Triggered
            </div>
            {triggeredAlerts.map((alert) => (
              <AlertCard
                key={alert.id}
                alert={alert}
                onToggle={() => toggleAlert({ client, alertId: alert.id })}
                onRemove={() => removeAlert({ client, alertId: alert.id })}
              />
            ))}
          </>
        )}
      </div>

      {/* Create Alert Dialog */}
      <Dialog open={showForm} onClose={() => setShowForm(false)}>
        <AlertForm
          onSubmit={handleCreateAlert}
          onCancel={() => setShowForm(false)}
        />
      </Dialog>
    </div>
  );
};
