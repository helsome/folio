import React from 'react';
import { parseAnswerBlock } from '@finagent/core';
import type { AnswerBlock } from '@finagent/core';
import { AnswerBlockInvalid, AnswerBlockLoading } from './AnswerBlockFrame';
import { ComparisonTableBlockView } from './ComparisonTableBlockView';
import { DataTableBlockView } from './DataTableBlockView';
import { MetricGridBlockView } from './MetricGridBlockView';
import { TimeSeriesChartBlockView } from './TimeSeriesChartBlockView';

/**
 * Parse, validate, and render one fenced block body. Streaming semantics:
 * - valid payload → render deterministically right away (fence may still be open);
 * - unparseable payload with the fence still open → loading placeholder;
 * - closed fence that fails validation → muted text degradation. The message
 *   itself never crashes: no invalid payload reaches a renderer path that
 *   could throw, and renderers only read typed fields.
 */
export const AnswerBlockView: React.FC<{ body: string; closed: boolean }> = ({ body, closed }) => {
  const result = parseAnswerBlock(body);
  if (result.ok && result.block) {
    const block: AnswerBlock = result.block;
    const streaming = !closed;
    switch (block.type) {
      case 'metric_grid':
        return <MetricGridBlockView block={block} streaming={streaming} />;
      case 'data_table':
        return <DataTableBlockView block={block} streaming={streaming} />;
      case 'time_series_chart':
        return <TimeSeriesChartBlockView block={block} streaming={streaming} />;
      case 'comparison_table':
        return <ComparisonTableBlockView block={block} streaming={streaming} />;
    }
  }
  if (result.reason === 'invalid_json' && !closed) {
    return <AnswerBlockLoading />;
  }
  return <AnswerBlockInvalid body={body} />;
};
