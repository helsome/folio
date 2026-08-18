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
    <div className="flex h-full flex-col overflow-y-auto p-4" data-testid="compare-workspace">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-foreground/48">
          {t('compare.title')}
        </h3>
        <DataFreshness
          providerName="Longbridge"
          updatedAtMs={state.data?.generatedAt}
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          data-testid="compare-symbol-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') add();
          }}
          placeholder={t('compare.symbolPlaceholder')}
          className="mac-input flex-1 px-3 py-2 rounded-[10px] text-[13px] text-foreground placeholder:text-foreground/38 focus:outline-none focus:ring-2 focus:ring-accent/28 transition-smooth"
        />
        <Button size="sm" onClick={add} disabled={symbols.length >= 4}>
          <span data-testid="compare-add">{t('common.add')}</span>
        </Button>
      </div>

      {symbols.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {symbols.map((symbol) => (
            <button
              key={symbol}
              type="button"
              onClick={() => remove(symbol)}
              className="flex items-center gap-1 rounded-full bg-foreground/8 px-3 py-1 text-[12px] text-foreground/70 hover:bg-foreground/14 transition-smooth"
            >
              {symbol}
              <span className="text-foreground/44">×</span>
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 flex-1">
        {state.loading ? (
          <div className="h-32 animate-pulse rounded-[12px] bg-foreground/6" />
        ) : state.error ? (
          <div className="py-8 text-center text-[13px] text-foreground/44">{state.error}</div>
        ) : state.data ? (
          <CompareTable comparison={state.data} />
        ) : (
          <div className="py-8 text-center text-[13px] text-foreground/44">
            {t('compare.addTwo')}
          </div>
        )}
      </div>

      <div className="mt-3 text-[11px] text-foreground/44">
        {t('compare.agentContext')}
      </div>
    </div>
  );
};
