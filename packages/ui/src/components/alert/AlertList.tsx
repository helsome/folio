import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAtom, useSetAtom } from 'jotai';
import { Search, SlidersHorizontal } from 'lucide-react';
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
import { ALERT_TYPE_KEYS, AlertCard } from './AlertCard';
import { AlertForm } from './AlertForm';
import { Button } from '../primitives/Button';
import { Dialog } from '../primitives/Dialog';

export const AlertList: React.FC<{ initialSymbol?: string }> = ({ initialSymbol = '' }) => {
  const { t } = useTranslation();
  const client = useFinagentClient();
  const [state] = useAtom(alertStateAtom);
  const loadAlerts = useSetAtom(loadAlertsAtom);
  const toggleAlert = useSetAtom(toggleAlertAtom);
  const removeAlert = useSetAtom(removeAlertAtom);
  const addAlert = useSetAtom(addAlertAtom);

  const [showForm, setShowForm] = useState(false);
  const [formSymbol, setFormSymbol] = useState(initialSymbol);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'paused'>('all');

  useEffect(() => {
    setFormSymbol(initialSymbol);
  }, [initialSymbol]);

  useEffect(() => {
    loadAlerts(client);
  }, [client, loadAlerts]);

  const handleCreateAlert = (draft: AlertRuleDraft) => {
    addAlert({ client, rule: buildAlertRule(draft) });
    setShowForm(false);
  };

  const normalizedQuery = query.trim().toLowerCase();
  const filteredRules = state.rules.filter((rule) => {
    if (statusFilter === 'active' && !rule.enabled) return false;
    if (statusFilter === 'paused' && rule.enabled) return false;
    if (!normalizedQuery) return true;
    const typeLabel = t(ALERT_TYPE_KEYS[rule.type]);
    const symbol = rule.type === 'portfolio_drawdown' ? '' : rule.symbol;
    return `${symbol ?? ''} ${typeLabel}`.toLowerCase().includes(normalizedQuery);
  });

  return (
    <div className="flex h-full flex-col bg-surface-muted/35">
      <div className="border-b border-border bg-surface-raised px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[15px] font-semibold text-foreground">{t('navigation.alerts')}</div>
            <div className="mt-0.5 text-[11px] text-foreground/45">
              {t('alerts.count', { count: state.rules.length })}
            </div>
          </div>
          <Button size="sm" onClick={() => setShowForm(true)}>
            {t('alerts.new')}
          </Button>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <label className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground/35" aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('alerts.form.symbol')}
              aria-label={t('alerts.form.symbol')}
              className="h-8 w-full rounded-[7px] border border-input bg-surface pl-8 pr-2.5 text-[12px] text-foreground placeholder:text-foreground/35 focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <div className="relative shrink-0">
            <SlidersHorizontal className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground/35" aria-hidden="true" />
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as 'all' | 'active' | 'paused')}
              aria-label={t('alerts.count', { count: state.rules.length })}
              className="h-8 appearance-none rounded-[7px] border border-input bg-surface py-1 pl-8 pr-7 text-[12px] text-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="all">All</option>
              <option value="active">{t('alerts.status.active')}</option>
              <option value="paused">{t('alerts.status.paused')}</option>
            </select>
          </div>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {state.loading && (
          <div className="rounded-[10px] border border-border bg-surface-raised px-4 py-10 text-center text-[12px] text-foreground/45">
            {t('alerts.loading')}
          </div>
        )}

        {!state.loading && state.rules.length === 0 && state.events.length === 0 && (
          <div className="rounded-[10px] border border-dashed border-border bg-surface-raised px-4 py-10 text-center text-[12px] text-foreground/45">
            <p>{t('alerts.noAlerts')}</p>
            <Button size="sm" onClick={() => setShowForm(true)} className="mt-2">
              {t('alerts.createFirst')}
            </Button>
          </div>
        )}

        {!state.loading && state.rules.length > 0 && filteredRules.length === 0 && (
          <div className="rounded-[10px] border border-dashed border-border bg-surface-raised px-4 py-8 text-center text-[12px] text-foreground/45">
            {t('alerts.noAlerts')}
          </div>
        )}

        {filteredRules.map((rule) => (
          <AlertCard
            key={rule.id}
            rule={rule}
            onToggle={() => toggleAlert({ client, ruleId: rule.id })}
            onRemove={() => removeAlert({ client, ruleId: rule.id })}
          />
        ))}

        {state.events.length > 0 && (
          <>
            <div className="px-1 pt-2 text-[11px] font-semibold uppercase tracking-[.1em] text-foreground/45">
              {t('alerts.recentTriggers')}
            </div>
            {state.events.slice(0, 10).map((event) => (
              <div
                key={event.id}
                className="rounded-[10px] border border-border bg-surface-raised p-3 text-[12px] text-foreground/58"
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
        <AlertForm
          key={formSymbol || 'generic'}
          symbol={formSymbol}
          onSubmit={handleCreateAlert}
          onCancel={() => setShowForm(false)}
        />
      </Dialog>
    </div>
  );
};
