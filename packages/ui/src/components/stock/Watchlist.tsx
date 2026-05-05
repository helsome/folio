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
      <div className="p-3 border-b border-[oklch(var(--bg-primary))]">
        <div className="text-xs font-semibold text-[oklch(var(--text-secondary))] uppercase tracking-wide mb-2">
          Watchlist
        </div>
        {/* Add symbol input */}
        <div className="flex gap-1">
          <Input
            value={newSymbol}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              setNewSymbol(e.target.value.toUpperCase());
              setError('');
            }}
            onKeyDown={handleKeyDown}
            placeholder="AAPL.US"
            error={error}
            className="flex-1 text-sm"
          />
          <Button size="sm" onClick={handleAddSymbol}>
            +
          </Button>
        </div>
      </div>

      {/* Watchlist items */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {watchlist.map((symbol) => (
          <WatchlistItem
            key={symbol}
            symbol={symbol}
            client={client}
            onRemove={() => removeSymbol(symbol)}
          />
        ))}
        {watchlist.length === 0 && (
          <div className="text-center py-8 text-[oklch(var(--text-secondary))] text-sm">
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
      <div className="p-3 bg-[oklch(var(--bg-secondary))] rounded-lg animate-pulse">
        <div className="h-4 w-16 bg-[oklch(var(--bg-primary))] rounded mb-2" />
        <div className="h-6 w-24 bg-[oklch(var(--bg-primary))] rounded" />
      </div>
    );
  }

  if (cache.error && !cache.data) {
    return (
      <div className="p-3 bg-[oklch(var(--bg-secondary))] rounded-lg">
        <div className="flex justify-between items-start">
          <div>
            <div className="font-semibold text-[oklch(var(--text-primary))]">{symbol}</div>
            <div className="text-sm text-red-500">{cache.error}</div>
          </div>
          <button
            onClick={onRemove}
            className="text-[oklch(var(--text-secondary))] hover:text-red-500"
          >
            ×
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
      <div className="flex justify-between items-center p-3 bg-[oklch(var(--bg-secondary))] rounded-lg hover:opacity-80 cursor-pointer">
        <div>
          <div className="font-semibold text-[oklch(var(--text-primary))]">{quote.symbol}</div>
          <div className="text-lg font-bold text-[oklch(var(--text-primary))]">
            ${quote.lastPrice.toFixed(2)}
          </div>
        </div>
        <div className={`text-right ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
          <div className="font-medium">
            {isPositive ? '+' : ''}{quote.changePercent.toFixed(2)}%
          </div>
        </div>
      </div>
      {/* Remove button on hover */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-[oklch(var(--bg-primary))] rounded-full w-6 h-6 flex items-center justify-center text-[oklch(var(--text-secondary))] hover:text-red-500"
      >
        ×
      </button>
    </div>
  );
};
