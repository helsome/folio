import React, { useEffect, useReducer, useRef } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import {
  watchlistAtom,
  quoteCacheAtomFamily,
  watchlistLatestTimestampAtom,
  fetchQuoteAtom,
  addToWatchlistAtom,
  removeFromWatchlistAtom,
  activeSymbolAtom,
  activeViewAtom,
} from '../../atoms';
import { useFinagentClient } from '../../client';
import { Input } from '../primitives/Input';
import { Button } from '../primitives/Button';
import { DataFreshness } from '../primitives/DataFreshness';

const SYMBOL_REGEX = /^[A-Z0-9]{1,5}\.(US|HK|SG|SH|SZ|HAS)$/;
const DASH = '\u2014';

const formatPrice = (value: number): string => `$${value.toFixed(2)}`;
const formatPercent = (value: number): string =>
  `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;

export const Watchlist: React.FC = () => {
  const client = useFinagentClient();
  const watchlist = useAtomValue(watchlistAtom);
  const addSymbol = useSetAtom(addToWatchlistAtom);
  const removeSymbol = useSetAtom(removeFromWatchlistAtom);
  const setActiveSymbol = useSetAtom(activeSymbolAtom);
  const setActiveView = useSetAtom(activeViewAtom);
  const activeSymbol = useAtomValue(activeSymbolAtom);
  const latestTimestamp = useAtomValue(watchlistLatestTimestampAtom);

  const [newSymbol, setNewSymbol] = React.useState('');
  const [error, setError] = React.useState('');

  // Local static-info name cache: symbol -> display name.
  const nameCache = useRef(new Map<string, string>());
  const inflight = useRef(new Set<string>());
  const [, force] = useReducer((x: number) => x + 1, 0);

  const resolveName = (symbol: string): string => {
    const cached = nameCache.current.get(symbol);
    if (cached !== undefined) return cached;
    if (!inflight.current.has(symbol)) {
      inflight.current.add(symbol);
      client.market
        .getStaticInfo(symbol)
        .then((res) => {
          nameCache.current.set(
            symbol,
            res.ok && res.data.name ? res.data.name : symbol
          );
        })
        .catch(() => {
          nameCache.current.set(symbol, symbol);
        })
        .finally(() => {
          inflight.current.delete(symbol);
          force();
        });
    }
    return symbol;
  };

  const handleAddSymbol = () => {
    const symbol = newSymbol.trim().toUpperCase();
    if (!symbol) return;

    if (!SYMBOL_REGEX.test(symbol)) {
      setError('Invalid symbol format. Use: AAPL.US, 0700.HK');
      return;
    }

    if (watchlist.includes(symbol)) {
      setError('Symbol already in watchlist');
      return;
    }

    addSymbol(symbol);
    setNewSymbol('');
    setError('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleAddSymbol();
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b mac-section-divider px-3 py-3">
        <div className="mb-2 flex items-center justify-between px-0.5">
          <span className="text-[11px] font-semibold uppercase text-foreground/42">
            Watchlist
          </span>
          <DataFreshness
            providerName="Longbridge"
            updatedAtMs={
              latestTimestamp ? latestTimestamp * 1000 : undefined
            }
          />
        </div>
        <div className="flex gap-1.5">
          <Input
            value={newSymbol}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              setNewSymbol(e.target.value.toUpperCase());
              setError('');
            }}
            onKeyDown={handleKeyDown}
            placeholder="AAPL.US"
            error={error}
            className="h-8 flex-1 text-[12px]"
          />
          <Button size="icon" onClick={handleAddSymbol} aria-label="Add symbol">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
              <path d="M6.5 2.25v8.5M2.25 6.5h8.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-1.5">
        {watchlist.map((symbol) => (
          <WatchlistRow
            key={symbol}
            symbol={symbol}
            name={resolveName(symbol)}
            active={symbol === activeSymbol}
            onSelect={() => {
              setActiveSymbol(symbol);
              setActiveView('overview');
            }}
            onRemove={() => removeSymbol(symbol)}
          />
        ))}
        {watchlist.length === 0 && (
          <div className="py-8 text-center text-[13px] text-foreground/44">
            <p>No symbols in watchlist</p>
            <p className="mt-1">Add symbols above</p>
          </div>
        )}
      </div>
    </div>
  );
};

interface WatchlistRowProps {
  symbol: string;
  name: string;
  active: boolean;
  onSelect: () => void;
  onRemove: () => void;
}

const WatchlistRow: React.FC<WatchlistRowProps> = ({
  symbol,
  name,
  active,
  onSelect,
  onRemove,
}) => {
  const client = useFinagentClient();
  const cache = useAtomValue(quoteCacheAtomFamily(symbol));
  const fetchQuote = useSetAtom(fetchQuoteAtom);

  useEffect(() => {
    fetchQuote({ client, symbol });
    const interval = setInterval(() => fetchQuote({ client, symbol }), 30000);
    return () => clearInterval(interval);
  }, [client, symbol, fetchQuote]);

  const quote = cache.data;
  const loading = !quote && !cache.error;
  const changeColor = quote
    ? quote.change >= 0
      ? 'var(--positive)'
      : 'var(--negative)'
    : undefined;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={symbol}
      data-testid={`watchlist-row-${symbol}`}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      className={`group relative flex cursor-pointer items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 transition-colors ${
        active
          ? 'bg-[var(--mac-blue-soft)]'
          : 'hover:bg-[var(--mac-sidebar-hover)]'
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[12px] font-bold uppercase tracking-tight text-foreground">
            {symbol}
          </span>
          <span className="truncate text-[11px] text-foreground/48">{name}</span>
        </div>
      </div>

      <div className="shrink-0 text-right tabular-nums">
        {loading ? (
          <div className="h-3.5 w-14 animate-pulse rounded bg-foreground/10" />
        ) : quote ? (
          <>
            <div className="text-[12px] font-semibold text-foreground">
              {formatPrice(quote.lastPrice)}
            </div>
            <div className="text-[11px]" style={{ color: changeColor }}>
              {formatPercent(quote.changePercent)}
            </div>
          </>
        ) : (
          <div className="text-[12px] text-foreground/40">{DASH}</div>
        )}
      </div>

      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-foreground/38 opacity-0 transition-smooth hover:bg-foreground/8 hover:text-[var(--negative)] group-hover:opacity-100"
        aria-label={`Remove ${symbol}`}
      >
        <svg width="10" height="10" viewBox="0 0 11 11" fill="none" aria-hidden="true">
          <path d="M2.4 2.4l6.2 6.2M8.6 2.4 2.4 8.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
};
