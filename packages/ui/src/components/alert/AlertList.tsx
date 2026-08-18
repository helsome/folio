import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAtom, useSetAtom } from 'jotai';
import type { AlertRuleDraft } from '../../atoms';
import {
  alertStateAtom,
  buildAlertRule,
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

export const AlertList: React.FC = () => {
  const { t } = useTranslation();
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

  const handleCreateAlert = (draft: AlertRuleDraft) => {
    addAlert({ client, rule: buildAlertRule(draft) });
    setShowForm(false);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-[oklch(var(--bg-primary))]">
        <div className="flex justify-between items-center">
          <div className="text-xs font-semibold text-[oklch(var(--text-secondary))] uppercase tracking-wide">
            {t('alerts.count', { count: state.rules.length })}
          </div>
          <Button size="sm" onClick={() => setShowForm(true)}>
            {t('alerts.new')}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {state.loading && (
          <div className="text-center py-8 text-[oklch(var(--text-secondary))]">
            {t('alerts.loading')}
          </div>
        )}

        {!state.loading && state.rules.length === 0 && state.events.length === 0 && (
          <div className="text-center py-8 text-[oklch(var(--text-secondary))]">
            <p>{t('alerts.noAlerts')}</p>
            <Button size="sm" variant="ghost" onClick={() => setShowForm(true)} className="mt-2">
              {t('alerts.createFirst')}
            </Button>
          </div>
        )}

        {state.rules.map((rule) => (
          <AlertCard
            key={rule.id}
            rule={rule}
            onToggle={() => toggleAlert({ client, ruleId: rule.id })}
            onRemove={() => removeAlert({ client, ruleId: rule.id })}
          />
        ))}

        {state.events.length > 0 && (
          <>
            <div className="text-xs text-[oklch(var(--text-secondary))] px-2 py-1 mt-4">
              {t('alerts.recentTriggers')}
            </div>
            {state.events.slice(0, 10).map((event) => (
              <div
                key={event.id}
                className="p-2 rounded-lg bg-[oklch(var(--bg-secondary))]/50 text-xs text-[oklch(var(--text-secondary))]"
              >
                <span className="font-medium text-[oklch(var(--text-primary))]">{event.title}</span>
                <span className="ml-2">{event.message}</span>
                <div className="mt-0.5 opacity-60">
                  {new Date(event.triggeredAt).toLocaleString()}
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      <Dialog open={showForm} onClose={() => setShowForm(false)}>
        <AlertForm onSubmit={handleCreateAlert} onCancel={() => setShowForm(false)} />
      </Dialog>
    </div>
  );
};
