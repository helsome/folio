import React from 'react';
import type { MetricGridBlock } from '@finagent/core';
import { formatBlockChange, formatBlockValue, formatIsoDate } from './blockFormat';
import { AnswerBlockFrame } from './AnswerBlockFrame';

/** KPI cards rendered deterministically from a `metric_grid` block. */
export const MetricGridBlockView: React.FC<{ block: MetricGridBlock; streaming?: boolean }> = ({
  block,
  streaming,
}) => {
  return (
    <AnswerBlockFrame block={block} streaming={streaming}>
      <div className="grid grid-cols-2 gap-2">
        {block.metrics.map((metric, index) => {
          const deltaUp = (metric.change ?? metric.changePercent ?? 0) > 0;
          const deltaDown = (metric.change ?? metric.changePercent ?? 0) < 0;
          const tone = deltaUp
            ? 'text-[var(--mac-green)]'
            : deltaDown
              ? 'text-[var(--mac-red)]'
              : 'text-foreground/48';
          const delta =
            metric.change !== undefined && metric.changePercent !== undefined
              ? `${formatBlockChange(metric.change, metric.unit, metric.currency)} (${formatBlockChange(metric.changePercent, 'percent')})`
              : metric.change !== undefined
                ? formatBlockChange(metric.change, metric.unit, metric.currency)
                : metric.changePercent !== undefined
                  ? formatBlockChange(metric.changePercent, 'percent')
                  : '';
          return (
            <div
              key={`${metric.label}-${index}`}
              className="rounded-[8px] border mac-section-divider bg-surface px-2.5 py-2"
            >
              <div className="truncate text-[10.5px] font-medium uppercase tracking-wide text-foreground/44" title={metric.label}>
                {metric.label}
              </div>
              <div className="mt-0.5 text-[15px] font-semibold tracking-tight text-foreground">
                {formatBlockValue(metric.value, metric.unit, metric.currency)}
              </div>
              <div className="flex items-center justify-between gap-1 text-[10.5px]">
                <span className={`truncate font-semibold ${tone}`}>{delta}</span>
                {metric.asOf && <span className="shrink-0 text-foreground/36">{formatIsoDate(metric.asOf)}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </AnswerBlockFrame>
  );
};
