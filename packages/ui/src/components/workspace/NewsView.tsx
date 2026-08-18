import React, { useEffect, useState } from 'react';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import type { NewsItem } from '@finagent/core';
import { activeSymbolAtom } from '../../atoms';
import { useFinagentClient } from '../../client';

type TFunc = (key: string, vars?: Record<string, unknown>) => string;

const relativeTime = (timestamp: number, t: TFunc): string => {
  const diff = Date.now() - timestamp;
  if (diff < 0) return t('security.news.justNow');
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return t('security.news.justNow');
  if (minutes < 60) return t('security.news.minutesAgo', { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('security.news.hoursAgo', { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return t('security.news.daysAgo', { n: days });
  const months = Math.floor(days / 30);
  if (months < 12) return t('security.news.monthsAgo', { n: months });
  const years = Math.floor(months / 12);
  return t('security.news.yearsAgo', { n: years });
};

export const NewsView: React.FC = () => {
  const { t } = useTranslation();
  const client = useFinagentClient();
  const symbol = useAtomValue(activeSymbolAtom);

  const [news, setNews] = useState<NewsItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!symbol) {
      setNews(null);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setNews(null);

    client.market.getNews(symbol).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setNews(res.data);
      } else {
        setError(res.error.message);
      }
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [client, symbol]);

  if (!symbol) return null;

  if (loading) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-12 animate-pulse rounded-[10px] bg-foreground/6"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-[12px] text-foreground/54">
        {t('security.news.unavailable', { error })}
      </div>
    );
  }

  if (!news || news.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-[13px] text-foreground/44">
        {t('security.news.none')}
      </div>
    );
  }

  return (
    <ul className="divide-y divide-[var(--mac-border)]">
      {news.map((item) => (
        <li key={item.id}>
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-[var(--mac-sidebar-hover)]"
          >
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium leading-snug text-foreground group-hover:text-[var(--mac-blue)]">
                {item.title}
              </div>
              {item.summary && (
                <div className="mt-1 line-clamp-2 text-[12px] text-foreground/48">
                  {item.summary}
                </div>
              )}
            </div>
            <span className="shrink-0 pt-0.5 text-[11px] tabular-nums text-foreground/42">
              {relativeTime(item.timestamp, t)}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
};
