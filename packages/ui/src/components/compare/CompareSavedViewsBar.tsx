import React, { useEffect, useRef, useState } from 'react';
import { Save, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../primitives/Button';
import {
  createSavedCompareView,
  loadSavedCompareViews,
  persistSavedCompareViews,
  readLastSavedCompareViewId,
  removeSavedCompareView,
  savedCompareViewMatches,
  updateCompareViewSettings,
  upsertSavedCompareView,
  writeLastSavedCompareViewId,
  type CompareViewSettings,
  type SavedCompareView,
} from '../../lib/compareViewState';

interface CompareSavedViewsBarProps {
  symbols: string[];
  settings: CompareViewSettings;
  onRestore: (view: SavedCompareView) => void;
  onSettingsChange: (settings: CompareViewSettings) => void;
}

const SELECT_CLASS =
  'h-8 min-w-0 rounded-[7px] border border-input bg-surface-raised px-2.5 text-[11.5px] text-foreground transition-smooth hover:border-[var(--mac-border-strong)] focus:border-[var(--mac-blue)] focus:outline-none focus:ring-2 focus:ring-[var(--mac-blue)]/18';

/** Versioned local saved views; restoring a view never restores stale market data. */
export const CompareSavedViewsBar: React.FC<CompareSavedViewsBarProps> = ({
  symbols,
  settings,
  onRestore,
  onSettingsChange,
}) => {
  const { t } = useTranslation();
  const [views, setViews] = useState<SavedCompareView[]>(loadSavedCompareViews);
  const [selectedId, setSelectedId] = useState('');
  const [name, setName] = useState('');
  const restoredRef = useRef(false);

  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    if (symbols.length > 0) {
      const matchingView = views.find((view) => savedCompareViewMatches(view, symbols, settings));
      if (matchingView) {
        setSelectedId(matchingView.id);
        setName(matchingView.name);
      }
      return;
    }
    const lastId = readLastSavedCompareViewId();
    const lastView = views.find((view) => view.id === lastId);
    if (!lastView) return;
    setSelectedId(lastView.id);
    setName(lastView.name);
    onRestore(lastView);
  }, [onRestore, settings, symbols, views]);

  const selectView = (id: string) => {
    setSelectedId(id);
    writeLastSavedCompareViewId(id || null);
    const view = views.find((candidate) => candidate.id === id);
    if (!view) {
      setName('');
      return;
    }
    setName(view.name);
    onRestore(view);
  };

  const saveView = () => {
    if (symbols.length < 2) return;
    const now = Date.now();
    const existing = views.find((view) => view.id === selectedId);
    const view = createSavedCompareView({
      id: existing?.id,
      name,
      symbols,
      settings,
      createdAt: existing?.createdAt,
      now,
    });
    if (view.symbols.length < 2) return;
    const nextViews = upsertSavedCompareView(views, view);
    setViews(nextViews);
    persistSavedCompareViews(nextViews);
    setSelectedId(view.id);
    setName(view.name);
    writeLastSavedCompareViewId(view.id);
  };

  const deleteView = () => {
    if (!selectedId) return;
    const nextViews = removeSavedCompareView(views, selectedId);
    setViews(nextViews);
    persistSavedCompareViews(nextViews);
    setSelectedId('');
    setName('');
    writeLastSavedCompareViewId(null);
  };

  return (
    <div className="border-b border-border/75 pb-3" data-testid="compare-saved-views">
      <div className="flex flex-wrap items-center gap-1.5">
        <label className="shrink-0 text-[10.5px] font-medium text-text-muted" htmlFor="compare-saved-view-select">
          {t('compare.savedViews.label')}
        </label>
        <select
          id="compare-saved-view-select"
          data-testid="compare-saved-view-select"
          value={selectedId}
          onChange={(event) => selectView(event.target.value)}
          className={`${SELECT_CLASS} min-w-[150px] flex-1`}
        >
          <option value="">{t('compare.savedViews.placeholder')}</option>
          {views.map((view) => (
            <option key={view.id} value={view.id}>
              {view.name}
            </option>
          ))}
        </select>
        <input
          data-testid="compare-saved-view-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t('compare.savedViews.namePlaceholder')}
          aria-label={t('compare.savedViews.namePlaceholder')}
          maxLength={80}
          className="h-8 min-w-[140px] flex-1 rounded-[7px] border border-input bg-surface-raised px-2.5 text-[11.5px] text-foreground placeholder:text-foreground/38 transition-smooth hover:border-[var(--mac-border-strong)] focus:border-[var(--mac-blue)] focus:outline-none focus:ring-2 focus:ring-[var(--mac-blue)]/18"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-testid="compare-saved-view-save"
          disabled={symbols.length < 2}
          onClick={saveView}
          className="h-8 gap-1.5 rounded-[7px] px-2.5 text-[11.5px]"
        >
          <Save className="h-3.5 w-3.5" aria-hidden="true" />
          {t('compare.savedViews.save')}
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          data-testid="compare-saved-view-delete"
          disabled={!selectedId}
          onClick={deleteView}
          aria-label={t('compare.savedViews.delete')}
          title={t('compare.savedViews.delete')}
          className="h-8 w-8 rounded-[7px] text-text-muted hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <label className="flex items-center gap-1.5 text-[10.5px] text-text-muted">
          <span>{t('compare.viewSettings.metrics')}</span>
          <select
            data-testid="compare-metric-preset"
            value={settings.metricPreset}
            onChange={(event) => onSettingsChange(updateCompareViewSettings(settings, {
              metricPreset: event.target.value as CompareViewSettings['metricPreset'],
            }))}
            className={SELECT_CLASS}
          >
            <option value="all">{t('compare.viewSettings.presets.all')}</option>
            <option value="priceReturns">{t('compare.viewSettings.presets.priceReturns')}</option>
            <option value="valuation">{t('compare.viewSettings.presets.valuation')}</option>
            <option value="fundamentals">{t('compare.viewSettings.presets.fundamentals')}</option>
          </select>
        </label>

        <label className="flex items-center gap-1.5 text-[10.5px] text-text-muted">
          <span>{t('compare.viewSettings.returnWindow')}</span>
          <select
            data-testid="compare-return-window"
            value={settings.returnWindow}
            onChange={(event) => onSettingsChange(updateCompareViewSettings(settings, {
              returnWindow: event.target.value as CompareViewSettings['returnWindow'],
            }))}
            className={SELECT_CLASS}
          >
            <option value="all">{t('compare.viewSettings.windows.all')}</option>
            <option value="1m">{t('compare.viewSettings.windows.oneMonth')}</option>
            <option value="3m">{t('compare.viewSettings.windows.threeMonths')}</option>
            <option value="1y">{t('compare.viewSettings.windows.oneYear')}</option>
          </select>
        </label>

        <label className="flex items-center gap-1.5 text-[10.5px] text-text-muted">
          <input
            type="checkbox"
            data-testid="compare-compact-rows"
            checked={settings.density === 'compact'}
            onChange={(event) => onSettingsChange(updateCompareViewSettings(settings, {
              density: event.target.checked ? 'compact' : 'comfortable',
            }))}
            className="h-3.5 w-3.5 rounded-[3px] border-input accent-[var(--mac-blue)]"
          />
          <span>{t('compare.viewSettings.compactRows')}</span>
        </label>
      </div>
    </div>
  );
};
