import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAtom } from 'jotai';
import { compareSymbolsAtom, comparisonStateAtom, withComparisonSymbols } from '../../atoms/compareAtoms';
import { loadComparison } from '../../client/compare';
import { Button } from '../primitives/Button';
import { DataFreshness } from '../primitives/DataFreshness';
import { CompareTable } from './CompareTable';

/** Symbol picker (2–4) + comparison table + agent-context note. */
export const CompareWorkspace: React.FC = () => {
  const { t } = useTranslation();
  const [symbols, setSymbols] = useAtom(compareSymbolsAtom);
  const [state, setState] = useAtom(comparisonStateAtom);
  const [input, setInput] = useState('');

  const build = useCallback(
    async (list: string[]) => {
      setState({ data: null, loading: true, error: null });
      const data = await loadComparison(list);
      if (data) {
        setState({ data, loading: false, error: null });
      } else {
        setState({ data: null, loading: false, error: t('compare.unavailable') });
      }
    },
    [setState, t]
  );

  useEffect(() => {
    if (symbols.length >= 2) build(symbols);
  }, [symbols, build]);

  const add = () => {
    const symbol = input.trim().toUpperCase();
    if (!symbol) return;
    setSymbols((current) => withComparisonSymbols(current, symbol, true));
    setInput('');
  };

  const remove = (symbol: string) => {
    setSymbols((current) => withComparisonSymbols(current, symbol, false));
  };

  return (
    <div className="folio-compare-view flex h-full flex-col overflow-y-auto bg-surface-raised p-5" data-testid="compare-workspace">
      <div className="folio-compare-header flex items-end justify-between gap-4 border-b border-border pb-4">
        <div>
          <p className="folio-eyebrow">{t('compare.title')}</p>
          <h2 className="folio-compare-title">{t('compare.title')}</h2>
          <p className="folio-compare-subtitle">{t('compare.agentContext')}</p>
        </div>
        <DataFreshness
          providerName="Longbridge"
          updatedAtMs={state.data?.generatedAt}
          className="shrink-0 pt-0.5"
        />
      </div>

      <div className="folio-compare-controls mt-4 rounded-[10px] border border-border bg-background/45 p-3">
        <div className="flex items-center gap-2">
          <input
            data-testid="compare-symbol-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') add();
            }}
            placeholder={t('compare.symbolPlaceholder')}
            className="h-9 min-w-0 flex-1 rounded-[8px] border border-input bg-surface-raised px-3 text-[12.5px] text-foreground placeholder:text-foreground/38 transition-smooth hover:border-[var(--mac-border-strong)] focus:border-[var(--mac-blue)] focus:outline-none focus:ring-2 focus:ring-[var(--mac-blue)]/18"
          />
          <Button
            size="sm"
            onClick={add}
            disabled={symbols.length >= 4}
            className="h-9 shrink-0 rounded-[8px] bg-[var(--mac-blue)] px-3.5 text-[12px] text-white hover:bg-[var(--mac-blue-hover)]"
          >
            <span data-testid="compare-add">{t('common.add')}</span>
          </Button>
        </div>

        {symbols.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {symbols.map((symbol) => (
              <button
                key={symbol}
                type="button"
                onClick={() => remove(symbol)}
                className="group inline-flex items-center gap-1 rounded-full border border-[rgba(var(--accent-rgb),0.22)] bg-[var(--mac-blue-soft)] px-2.5 py-1 text-[11.5px] font-medium text-[var(--mac-blue)] transition-smooth hover:border-[rgba(var(--accent-rgb),0.38)] hover:bg-[rgba(var(--accent-rgb),0.16)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--mac-blue)]"
              >
                {symbol}
                <span className="text-[var(--mac-blue)]/60 transition-colors group-hover:text-[var(--mac-blue)]">×</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 min-h-0 flex-1">
        {state.loading ? (
          <div className="h-32 animate-pulse rounded-[10px] border border-border bg-surface-muted/55" />
        ) : state.error ? (
          <div className="rounded-[10px] border border-dashed border-border px-4 py-8 text-center text-[12.5px] text-text-muted">{state.error}</div>
        ) : state.data ? (
          <CompareTable comparison={state.data} />
        ) : (
          <div className="folio-compare-empty rounded-[10px] border border-dashed border-border px-4 py-8 text-center text-[12.5px] text-text-muted">
            {t('compare.addTwo')}
          </div>
        )}
      </div>

      <div className="mt-4 border-t border-border pt-3 text-[10.5px] leading-relaxed text-text-muted">
        {t('compare.agentContext')}
      </div>
    </div>
  );
};
