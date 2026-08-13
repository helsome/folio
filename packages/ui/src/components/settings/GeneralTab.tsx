import React from 'react';
import { useAtom } from 'jotai';
import { llmStateAtom } from '../../atoms';

/** Minimal, real app + agent-runtime information. */
export const GeneralTab: React.FC = () => {
  const [state] = useAtom(llmStateAtom);
  const model = state.model;

  const rows: Array<{ label: string; value: string }> = [
    { label: 'Application', value: 'Folio' },
    { label: 'Agent runtime', value: state.runtimeProvider },
    { label: 'Streaming', value: state.isStreaming ? 'Enabled' : 'Disabled' },
    { label: 'Active model', value: model ? (model.name || `${model.provider}/${model.id}`) : '—' },
    { label: 'Thinking level', value: state.thinkingLevel },
  ];

  return (
    <div className="max-w-2xl">
      <div className="mac-stock-tile rounded-[14px] p-5">
        <h2 className="mb-4 text-[14px] font-semibold text-foreground">Application</h2>
        <dl className="space-y-3">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-4">
              <dt className="text-[13px] text-foreground/54">{row.label}</dt>
              <dd className="text-right text-[13px] font-medium text-foreground">{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
};
