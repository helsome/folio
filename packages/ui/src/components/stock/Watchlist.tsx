import React, { useEffect } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import {
  watchlistAtom,
  quoteCacheAtomFamily,
  fetchQuoteAtom,
  addToWatchlistAtom,
  removeFromWatchlistAtom,
} from '../../atoms';
import { useFinagentClient } from '../../client';
import { StockCard } from './StockCard';
import { Input } from '../primitives/Input';
import { Button } from '../primitives/Button';

const SYMBOL_REGEX = /^[A-Z0-9]{1,5}\.(US|HK|SG|SH|SZ|HAS)$/;

export const Watchlist: React.FC = () => {
  const client = useFinagentClient();
  const [watchlist] = useAtom(watchlistAtom);
  const addSymbol = useSetAtom(addToWatchlistAtom);
  const removeSymbol = useSetAtom(removeFromWatchlistAtom);
  const fetchQuote = useSetAtom(fetchQuoteAtom);

  const [newSymbol, setNewSymbol] = React.useState('');
  const [error, setError] = React.useState('');

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
    <div className="flex flex-col h-full">
      <div className="border-b mac-section-divider px-3 py-3">
        <div className="mb-2 px-0.5 text-[11px] font-semibold uppercase text-foreground/42">
          Watchlist
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

      <div className="flex-1 space-y-2 overflow-y-auto p-2.5">
        {watchlist.map((symbol) => (
          <WatchlistItem
            key={symbol}
            symbol={symbol}
            client={client}
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

interface WatchlistItemProps {
  symbol: string;
  client: ReturnType<typeof useFinagentClient>;
  onRemove: () => void;
}

const WatchlistItem: React.FC<WatchlistItemProps> = ({ symbol, client, onRemove }) => {
  const [cache] = useAtom(quoteCacheAtomFamily(symbol));
  const fetchQuote = useSetAtom(fetchQuoteAtom);

  useEffect(() => {
    fetchQuote({ client, symbol });
    // Refresh every 30 seconds
    const interval = setInterval(() => fetchQuote({ client, symbol }), 30000);
    return () => clearInterval(interval);
  }, [client, symbol, fetchQuote]);

  if (cache.loading && !cache.data) {
    return (
      <div className="mac-stock-tile animate-pulse rounded-[10px] p-3">
        <div className="mb-2 h-3.5 w-16 rounded bg-foreground/8" />
        <div className="h-5 w-24 rounded bg-foreground/8" />
      </div>
    );
  }

  if (cache.error && !cache.data) {
    return (
      <div className="mac-stock-tile rounded-[10px] p-3">
        <div className="flex justify-between items-start">
          <div>
            <div className="text-[13px] font-semibold text-foreground">{symbol}</div>
            <div className="mt-0.5 text-[12px] text-[var(--mac-red)]">{cache.error}</div>
          </div>
          <button
            onClick={onRemove}
            className="flex h-6 w-6 items-center justify-center rounded-full text-foreground/42 transition-smooth hover:bg-foreground/7 hover:text-[var(--mac-red)]"
            aria-label={`Remove ${symbol}`}
          >
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
              <path d="M2.4 2.4l6.2 6.2M8.6 2.4 2.4 8.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  if (!cache.data) return null;

  const quote = cache.data;
  const isPositive = quote.change >= 0;

  return (
    <div className="group relative">
      <div className="mac-stock-tile flex cursor-pointer items-center justify-between rounded-[10px] p-3 transition-smooth hover:translate-y-[-1px]">
        <div>
          <div className="text-[13px] font-semibold text-foreground">{quote.symbol}</div>
          <div className="mt-0.5 text-[18px] font-semibold tracking-tight text-foreground">
            ${quote.lastPrice.toFixed(2)}
          </div>
        </div>
        <div className={`text-right ${isPositive ? 'text-[var(--mac-green)]' : 'text-[var(--mac-red)]'}`}>
          <div className="text-[13px] font-semibold">
            {isPositive ? '+' : ''}{quote.changePercent.toFixed(2)}%
          </div>
        </div>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-background/80 text-foreground/42 opacity-0 shadow-sm backdrop-blur transition-smooth hover:text-[var(--mac-red)] group-hover:opacity-100"
        aria-label={`Remove ${symbol}`}
      >
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
          <path d="M2.4 2.4l6.2 6.2M8.6 2.4 2.4 8.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
};
