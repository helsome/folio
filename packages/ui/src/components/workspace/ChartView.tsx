import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { activeSymbolAtom } from '../../atoms';
import { useFinagentClient } from '../../client';
import { Button } from '../primitives/Button';
import { DataFreshness } from '../primitives/DataFreshness';
import { FinancialKLineChart } from '../chart/FinancialKLineChart';
import { normalizeKlines, type FinancialBar } from '../chart/klineAdapter';

const PERIODS = ['1m', '5m', '15m', '1h', '1d', '1w'] as const;
type Period = (typeof PERIODS)[number];

type ChartStatus = 'loading' | 'ready' | 'error';

export function ChartView() {
  const { t } = useTranslation();
  const client = useFinagentClient();
  const symbol = useAtomValue(activeSymbolAtom);

  const [period, setPeriod] = useState<Period>('1d');
  const [bars, setBars] = useState<FinancialBar[]>([]);
  const [status, setStatus] = useState<ChartStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  // Monotonic request sequence; a response is dropped if a newer request has
  // since started (e.g. the user switched symbol or period mid-flight).
  const seqRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const seq = ++seqRef.current;

    if (!symbol) {
      setBars([]);
      setStatus('ready');
      setError(null);
      return;
    }

    setStatus('loading');
    setError(null);

    client.market
      .getKline({ symbol, period, limit: 300 })
      .then((result) => {
        if (cancelled || seq !== seqRef.current) return;
        if (!result.ok) {
          setStatus('error');
          setError(result.error.message);
          return;
        }
        setBars(normalizeKlines(result.data));
        setStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled || seq !== seqRef.current) return;
        setStatus('error');
        setError(err instanceof Error ? err.message : t('security.chart.loadFailed'));
      });
    return () => {
      cancelled = true;
    };
  }, [symbol, period, retryToken, client]);

  const retry = () => setRetryToken((token) => token + 1);

  let body: ReactNode;
  if (!symbol) {
    body = (
      <div className="flex h-full items-center justify-center text-[12.5px] text-text-muted">
        {t('security.chart.selectSymbol')}
      </div>
    );
  } else if (status === 'loading') {
    body = (
      <div className="flex h-full items-center justify-center text-[12.5px] text-text-muted">
        <span className="animate-pulse">{t('security.chart.loading')}</span>
      </div>
    );
  } else if (status === 'error') {
    body = (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
        <span className="text-[12.5px] text-negative">
          {error ?? t('security.chart.loadFailed')}
        </span>
        <Button variant="outline" size="sm" onClick={retry}>
          {t('common.retry')}
        </Button>
      </div>
    );
  } else if (bars.length === 0) {
    body = (
      <div className="flex h-full items-center justify-center text-[12.5px] text-text-muted">
        {t('security.chart.noData')}
      </div>
    );
  } else {
    body = (
      <FinancialKLineChart
        bars={bars}
        symbol={symbol}
        period={period}
        showMA
        showEMA
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        {PERIODS.map((value) => (
          <button
            key={value}
            onClick={() => setPeriod(value)}
            aria-pressed={period === value}
            className={`h-6 rounded-[6px] px-2.5 text-[11.5px] font-medium tabular-nums transition-smooth ${
              period === value
                ? 'bg-[var(--mac-blue-soft)] text-foreground'
                : 'text-text-muted hover:bg-[var(--mac-sidebar-hover)] hover:text-foreground'
            }`}
          >
            {value}
          </button>
        ))}
        <div className="ml-auto">
          <DataFreshness
            providerName="Longbridge"
            updatedAtMs={
              bars.length > 0 ? bars[bars.length - 1]!.timestamp * 1000 : undefined
            }
          />
        </div>
      </div>
      <div className="min-h-0 flex-1">{body}</div>
    </div>
  );
}
