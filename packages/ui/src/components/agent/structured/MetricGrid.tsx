import React from 'react';
import { cn } from '../../../lib/utils';

export interface MetricItem {
  label: string;
  value: string | number;
  tone?: 'positive' | 'negative' | 'muted' | 'default';
}

interface MetricGridProps {
  items: MetricItem[];
  columns?: 2 | 3;
}

const toneClass = (tone: MetricItem['tone']): string => {
  switch (tone) {
    case 'positive':
      return 'text-[var(--mac-green)]';
    case 'negative':
      return 'text-[var(--mac-red)]';
    case 'muted':
      return 'text-foreground/54';
    default:
      return 'text-foreground';
  }
};

/** Compact label/value grid used by structured tool-result cards. */
export const MetricGrid: React.FC<MetricGridProps> = ({ items, columns = 2 }) => {
  return (
    <div className={cn('grid gap-2', columns === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
      {items.map((item) => (
        <div key={item.label} className="rounded-[10px] bg-foreground/[0.04] px-3 py-2">
          <div className="text-[10px] font-medium uppercase tracking-wider text-foreground/42">
            {item.label}
          </div>
          <div className={cn('mt-0.5 truncate text-[13px] font-semibold', toneClass(item.tone))}>
            {item.value}
          </div>
        </div>
      ))}
    </div>
  );
};
